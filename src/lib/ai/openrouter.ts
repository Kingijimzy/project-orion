import { createHash } from 'node:crypto';
import { ProviderError, mapOpenRouterFailure } from './provider';

export type OpenRouterModel = {
  id: string;
  name: string;
  free: boolean | null;
  promptPrice: number | null;
  completionPrice: number | null;
  requestPrice: number | null;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
};
type RawModel = {
  id?: unknown; name?: unknown; context_length?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown; request?: unknown };
};
type CatalogCache = { keyHash: string; expires: number; models: OpenRouterModel[] };
let catalogCache: CatalogCache | null = null;
const CACHE_MS = 5 * 60 * 1000;

function price(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parseOpenRouterModels(payload: unknown): OpenRouterModel[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new ProviderError('OpenRouter returned a malformed model catalogue.', undefined, 'malformed_catalog');
  }
  const output: OpenRouterModel[] = [];
  for (const raw of (payload as { data: RawModel[] }).data) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    const inputModalities = stringList(raw.architecture?.input_modalities);
    const outputModalities = stringList(raw.architecture?.output_modalities);
    if (!inputModalities.includes('text') || !outputModalities.includes('text')) continue;
    const promptPrice = price(raw.pricing?.prompt);
    const completionPrice = price(raw.pricing?.completion);
    const requestPrice = price(raw.pricing?.request);
    const tokenPricesKnown = promptPrice !== null && completionPrice !== null;
    const explicitlyFree = raw.id.endsWith(':free') || raw.id === 'openrouter/free';
    const allKnownPricesZero = tokenPricesKnown && promptPrice === 0 && completionPrice === 0 && requestPrice === 0;
    const free = tokenPricesKnown && promptPrice === 0 && completionPrice === 0 && (requestPrice === 0 || (requestPrice === null && explicitlyFree))
      ? true
      : (promptPrice !== null && promptPrice > 0) || (completionPrice !== null && completionPrice > 0) || (requestPrice !== null && requestPrice > 0)
        ? false
        : allKnownPricesZero ? true : null;
    output.push({
      id: raw.id,
      name: raw.name,
      free,
      promptPrice,
      completionPrice,
      requestPrice,
      contextLength: typeof raw.context_length === 'number' && Number.isFinite(raw.context_length) ? raw.context_length : null,
      inputModalities,
      outputModalities,
    });
  }
  return output;
}

export async function getOpenRouterModels(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<OpenRouterModel[]> {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new ProviderError('OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.', undefined, 'provider_not_configured');
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  if (catalogCache?.keyHash === keyHash && catalogCache.expires > Date.now()) return catalogCache.models;
  let response: Response;
  try {
    response = await fetcher('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ProviderError('Could not reach OpenRouter to load its model catalogue.', undefined, 'network_error');
  }
  if (!response.ok) throw mapOpenRouterFailure(response.status);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new ProviderError('OpenRouter returned a malformed model catalogue.', undefined, 'malformed_catalog'); }
  const models = parseOpenRouterModels(payload);
  catalogCache = { keyHash, expires: Date.now() + CACHE_MS, models };
  return models;
}

export async function resolveOpenRouterModel(modelId: string, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<OpenRouterModel> {
  const models = await getOpenRouterModels(env, fetcher);
  const model = models.find((item) => item.id === modelId);
  if (!model) throw new ProviderError('This OpenRouter model is not in the verified catalogue or does not support text chat.', undefined, 'model_not_available');
  if (model.free === false && env.OPENROUTER_ALLOW_PAID_MODEL !== 'true') {
    throw new ProviderError('This model is priced. Set OPENROUTER_ALLOW_PAID_MODEL=true only if you explicitly allow paid requests.', undefined, 'paid_model_disabled');
  }
  if (model.free === null && env.OPENROUTER_ALLOW_PAID_MODEL !== 'true') {
    throw new ProviderError('OpenRouter pricing metadata is incomplete for this model. It cannot be selected without explicit paid-model permission.', undefined, 'unknown_pricing');
  }
  return model;
}

export async function checkOpenRouterStatus(env: NodeJS.ProcessEnv = process.env) {
  if (!env.OPENROUTER_API_KEY?.trim()) return { configured: false, message: 'Set OPENROUTER_API_KEY on the server.' };
  const modelId = env.OPENROUTER_MODEL?.trim();
  if (!modelId) return { configured: false, model: null, message: 'Set OPENROUTER_MODEL to a catalogue-listed free model.' };
  try {
    const models = await getOpenRouterModels(env);
    const paidUseEnabled = env.OPENROUTER_ALLOW_PAID_MODEL === 'true';
    const selected = models.find((model) => model.id === modelId);
    const allowed = Boolean(selected && (selected.free === true || paidUseEnabled));
    return { configured: allowed, model: modelId, paidUseEnabled, modelCount: models.filter((model) => model.free === true || paidUseEnabled).length, freeFilterAvailable: models.some((model) => model.free !== null), message: !selected ? 'Configured OpenRouter model is not present in the current text model catalogue.' : !allowed ? 'Configured OpenRouter model is not verified free; paid access is disabled.' : 'OpenRouter key, model catalogue, and selected model validated.' };
  } catch (error) {
    return { configured: false, message: error instanceof ProviderError ? error.message : 'Could not validate OpenRouter configuration.' };
  }
}

export function clearOpenRouterModelCacheForTests() { catalogCache = null; }
