export type AssistantMode = 'general' | 'trading-coach' | 'chart-analysis' | 'journal-review';
export type ProviderMessagePart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ProviderMessage = { role: 'user' | 'assistant'; content: string | ProviderMessagePart[] };
export type ProviderConfig = { model: string; apiKey: string; allowPaid: boolean };

/** Models verified against Google's published Standard Free Tier pricing on 2026-10-13. */
export const GEMINI_FREE_TIER_MODELS = new Set(['gemini-3.1-flash-lite']);

/** Provider boundary for future OpenAI-compatible adapters. Keys stay in server configuration. */
export interface ChatProvider {
  readonly id: string;
  stream(messages: ProviderMessage[], mode: AssistantMode, signal: AbortSignal): AsyncIterable<string>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly code = 'provider_error') {
    super(message);
    this.name = 'ProviderError';
  }
}

const modeInstructions: Record<AssistantMode, string> = {
  general: 'Answer clearly and accurately. State uncertainty when information is missing.',
  'trading-coach': 'You are Orion, a careful personal trading coach. Explain price action as a logical story. Separate supporting and conflicting evidence, explain invalidation, ask for missing information, and never invent live prices or claim to have fetched market data.',
  'chart-analysis': 'Help analyze chart evidence. Distinguish visual interpretation from verified OHLC calculations. Ask for symbol and timeframe when missing. Never invent market data.',
  'journal-review': 'Review trading process objectively. A losing trade is not automatically a bad setup and a winner does not prove good process. Separate plan quality, execution, and outcome.',
};

export function geminiConfiguration(env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim();
  const allowPaid = env.GEMINI_ALLOW_PAID_MODEL === 'true';
  if (!apiKey || !model || (!allowPaid && !GEMINI_FREE_TIER_MODELS.has(model))) return null;
  return { apiKey, model, allowPaid };
}

export function providerStatus(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = Boolean(env.GEMINI_API_KEY?.trim());
  const model = Boolean(env.GEMINI_MODEL?.trim());
  const paidEnabled = env.GEMINI_ALLOW_PAID_MODEL === 'true';
  return {
    gemini: { configured: apiKey && model && (paidEnabled || GEMINI_FREE_TIER_MODELS.has(env.GEMINI_MODEL?.trim() || '')), model: env.GEMINI_MODEL?.trim() || null, paidUseEnabled: paidEnabled },
    openRouter: { configured: false },
    openAICompatible: { configured: false },
    deepSeekCompatible: { configured: false },
  };
}

export function geminiEndpoint(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}

export function mapGeminiFailure(status: number, providerMessage?: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('Gemini rejected the configured API key or model. Check GEMINI_API_KEY and GEMINI_MODEL.', status, 'invalid_configuration');
  if (status === 429) return new ProviderError('Gemini quota or rate limit reached. Check the project quota and try again later.', status, 'rate_limited');
  if (status === 404) return new ProviderError('The configured Gemini model was not found. Check GEMINI_MODEL.', status, 'model_not_found');
  if (status >= 500) return new ProviderError('Gemini is temporarily unavailable. Try again shortly.', status, 'upstream_unavailable');
  return new ProviderError(providerMessage || 'Gemini could not complete this request.', status, 'provider_error');
}

function responseErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message.slice(0, 300) : undefined;
}

export function mapOpenRouterFailure(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('OpenRouter rejected the configured API key. Check OPENROUTER_API_KEY.', status, 'invalid_configuration');
  if (status === 402) return new ProviderError('OpenRouter reports insufficient credits or billing configuration. No fallback model was used.', status, 'billing_required');
  if (status === 404) return new ProviderError('OpenRouter could not find the selected model.', status, 'model_not_found');
  if (status === 429) return new ProviderError('OpenRouter rate limit reached. Try again later.', status, 'rate_limited');
  if (status >= 500) return new ProviderError('OpenRouter is temporarily unavailable. Try again shortly.', status, 'upstream_unavailable');
  return new ProviderError('OpenRouter could not complete this request.', status, 'provider_error');
}

export class GeminiProvider implements ChatProvider {
  readonly id = 'gemini';
  constructor(private readonly config: ProviderConfig, private readonly fetcher: typeof fetch = fetch) {}

  async *stream(messages: ProviderMessage[], mode: AssistantMode, signal: AbortSignal): AsyncIterable<string> {
    if (messages.some((message) => typeof message.content !== 'string')) {
      throw new ProviderError('Gemini image input is not enabled in Orion. Select a verified OpenRouter vision model.', undefined, 'image_model_unavailable');
    }
    const contents = messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content as string }] }));
    let response: Response;
    try {
      response = await this.fetcher(geminiEndpoint(this.config.model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: modeInstructions[mode] }] }, contents, generationConfig: { maxOutputTokens: 4096 } }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Could not reach Gemini. Check your network connection and retry.', undefined, 'network_error');
    }

    if (!response.ok) {
      let message: string | undefined;
      try { message = responseErrorMessage(await response.json()); } catch { /* response body can be empty */ }
      throw mapGeminiFailure(response.status, message);
    }
    if (!response.body) throw new ProviderError('Gemini returned an empty streaming response.', undefined, 'malformed_response');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); }
          catch { throw new ProviderError('Gemini returned malformed streaming data.', undefined, 'malformed_response'); }
          const candidates = (parsed as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates;
          for (const part of candidates?.[0]?.content?.parts || []) {
            if (typeof part.text === 'string') yield part.text;
          }
        }
        if (done) break;
      }
      if (buffer.startsWith('data:')) {
        const data = buffer.slice(5).trim();
        if (data && data !== '[DONE]') {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { throw new ProviderError('Gemini returned malformed streaming data.', undefined, 'malformed_response'); }
          const candidates = (parsed as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates;
          for (const part of candidates?.[0]?.content?.parts || []) if (typeof part.text === 'string') yield part.text;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class OpenRouterProvider implements ChatProvider {
  readonly id = 'openrouter';
  constructor(private readonly apiKey: string, private readonly model: string, private readonly fetcher: typeof fetch = fetch) {}

  async *stream(messages: ProviderMessage[], mode: AssistantMode, signal: AbortSignal): AsyncIterable<string> {
    let response: Response;
    try {
      response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'system', content: modeInstructions[mode] }, ...messages],
          stream: true,
          max_tokens: 4096,
        }),
        signal,
      });
    } catch {
      if (signal.aborted) throw new Error('Request stopped.');
      throw new ProviderError('Could not reach OpenRouter. Check your network connection and retry.', undefined, 'network_error');
    }
    if (!response.ok) throw mapOpenRouterFailure(response.status);
    if (!response.body) throw new ProviderError('OpenRouter returned an empty streaming response.', undefined, 'malformed_response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); }
          catch { throw new ProviderError('OpenRouter returned malformed streaming data.', undefined, 'malformed_response'); }
          const event = parsed as { error?: { code?: number; message?: string }; choices?: Array<{ delta?: { content?: unknown } }> };
          if (event.error) throw mapOpenRouterFailure(Number(event.error.code) || 500);
          const content = event.choices?.[0]?.delta?.content;
          if (typeof content === 'string') yield content;
          else if (Array.isArray(content)) {
            for (const part of content) if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') yield (part as { text: string }).text;
          }
        }
        if (done) break;
      }
      if (buffer.startsWith('data:')) {
        const data = buffer.slice(5).trim();
        if (data && data !== '[DONE]') {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { throw new ProviderError('OpenRouter returned malformed streaming data.', undefined, 'malformed_response'); }
          const content = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content;
          if (typeof content === 'string') yield content;
        }
      }
    } finally { reader.releaseLock(); }
  }
}

export async function createProvider(id: string, model: string, env: NodeJS.ProcessEnv = process.env, options: { requireImageInput?: boolean } = {}): Promise<ChatProvider> {
  if (id === 'gemini') {
    const config = geminiConfiguration(env);
    if (!config) throw new ProviderError('Gemini is not ready. Configure GEMINI_API_KEY and GEMINI_MODEL. With paid access disabled, only a model verified for the free tier is allowed.', undefined, 'provider_not_configured');
    if (model !== config.model) throw new ProviderError('The selected Gemini model does not match the server-configured GEMINI_MODEL.', undefined, 'model_not_available');
    return new GeminiProvider(config);
  }
  if (id === 'openrouter') {
    const { resolveOpenRouterModel } = await import('./openrouter');
    const selected = await resolveOpenRouterModel(model, env);
    if (options.requireImageInput && !selected.inputModalities.includes('image')) {
      throw new ProviderError('The selected OpenRouter model cannot inspect images. Choose a catalogue-listed model with image input.', undefined, 'image_model_unavailable');
    }
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new ProviderError('OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.', undefined, 'provider_not_configured');
    return new OpenRouterProvider(apiKey, model);
  }
  throw new ProviderError('This provider is not configured. Select Gemini or a configured OpenRouter model.', undefined, 'provider_not_configured');
}

export async function checkGeminiStatus(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  const config = geminiConfiguration(env);
  if (!config) {
    const hasCredentials = Boolean(env.GEMINI_API_KEY?.trim() && env.GEMINI_MODEL?.trim());
    return {
      configured: false,
      model: env.GEMINI_MODEL?.trim() || null,
      paidUseEnabled: env.GEMINI_ALLOW_PAID_MODEL === 'true',
      message: hasCredentials ? 'Paid access is disabled and the configured Gemini model is not on the verified free-tier allowlist.' : 'Set GEMINI_API_KEY and an explicit GEMINI_MODEL.',
    };
  }
  try {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`, {
      method: 'GET', headers: { 'x-goog-api-key': config.apiKey }, signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const details = await response.json() as { name?: unknown; supportedGenerationMethods?: unknown };
      const supported = Array.isArray(details.supportedGenerationMethods) && details.supportedGenerationMethods.includes('generateContent');
      if (!supported) return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'Gemini model is accessible but does not advertise generateContent support.' };
      return { configured: true, model: config.model, paidUseEnabled: config.allowPaid, message: config.allowPaid ? 'Gemini key and model access validated.' : 'Gemini key and free-tier model access validated; generation has not been tested.' };
    }
    if (response.status === 401 || response.status === 403) return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'Gemini rejected the configured API key or model. Check the key and Google AI Studio project access.' };
    if (response.status === 404) return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'The configured Gemini model was not found. Check GEMINI_MODEL.' };
    if (response.status === 429) return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'Gemini quota or rate limit reached; check the project quota and try again later.' };
    return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'Could not validate Gemini settings. Check provider availability.' };
  } catch {
    return { configured: false, model: config.model, paidUseEnabled: config.allowPaid, message: 'Could not reach Gemini to validate settings.' };
  }
}
