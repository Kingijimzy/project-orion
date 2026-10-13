import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOpenRouterModelCacheForTests, getOpenRouterModels, parseOpenRouterModels, resolveOpenRouterModel } from '../src/lib/ai/openrouter';
import { createProvider, mapOpenRouterFailure, OpenRouterProvider, ProviderError } from '../src/lib/ai/provider';

const catalog = { data: [
  { id: 'free/text-model', name: 'Free Text', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', request: '0' }, context_length: 8000 },
  { id: 'paid/text-model', name: 'Paid Text', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } },
  { id: 'unknown/text-model', name: 'Unknown Pricing', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
  { id: 'image/only', name: 'Image only', architecture: { input_modalities: ['image'], output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0', request: '0' } },
] };
const env = { OPENROUTER_API_KEY: 'private-key', OPENROUTER_ALLOW_PAID_MODEL: 'false' } as unknown as NodeJS.ProcessEnv;

test('OpenRouter model parser identifies free models only with complete zero pricing metadata', () => {
  const models = parseOpenRouterModels(catalog);
  assert.deepEqual(models.map((model) => [model.id, model.free]), [['free/text-model', true], ['paid/text-model', false], ['unknown/text-model', null]]);
  assert.throws(() => parseOpenRouterModels({ data: 'bad' }), /malformed model catalogue/);
});

test('OpenRouter accepts explicitly free catalogue entries with zero token prices when request pricing is omitted', () => {
  const models = parseOpenRouterModels({ data: [
    { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning (free)', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'ordinary/model', name: 'Unmarked zero model', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'bad/free-model:free', name: 'Inconsistent free label', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.01', completion: '0' } },
  ] });
  assert.deepEqual(models.map((model) => [model.id, model.free]), [
    ['nvidia/nemotron-3.5-lightning:free', true],
    ['ordinary/model', null],
    ['bad/free-model:free', false],
  ]);
});

test('OpenRouter model selection rejects paid and unknown-price models without opt-in', async () => {
  clearOpenRouterModelCacheForTests();
  const fetcher: typeof fetch = async () => Response.json(catalog);
  assert.equal((await resolveOpenRouterModel('free/text-model', env, fetcher)).free, true);
  await assert.rejects(resolveOpenRouterModel('paid/text-model', env, fetcher), (error: unknown) => error instanceof ProviderError && error.code === 'paid_model_disabled');
  await assert.rejects(resolveOpenRouterModel('unknown/text-model', env, fetcher), (error: unknown) => error instanceof ProviderError && error.code === 'unknown_pricing');
});

test('provider selection creates only configured Gemini and OpenRouter adapters', async () => {
  await assert.rejects(createProvider('deepseek', 'deepseek-chat', env), (error: unknown) => error instanceof ProviderError && error.code === 'provider_not_configured');
  const geminiEnv = { GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-test', GEMINI_ALLOW_PAID_MODEL: 'true' } as unknown as NodeJS.ProcessEnv;
  assert.equal((await createProvider('gemini', 'gemini-test', geminiEnv)).id, 'gemini');
  clearOpenRouterModelCacheForTests();
  const openrouterEnv = { ...env, OPENROUTER_ALLOW_PAID_MODEL: 'false' } as unknown as NodeJS.ProcessEnv;
  await getOpenRouterModels(openrouterEnv, async () => Response.json(catalog));
  const openRouter = new OpenRouterProvider('secret', 'free/text-model', async () => Response.json({ choices: [{ delta: { content: 'ok' } }] }));
  assert.equal(openRouter.id, 'openrouter');
  await assert.rejects(createProvider('openrouter', 'unlisted/model', openrouterEnv), /OpenRouter/);
});

test('OpenRouter streams chat-completion deltas and maps rate-limit errors', async () => {
  let url = '';
  let authorization = '';
  const provider = new OpenRouterProvider('server-secret', 'free/text-model', async (input, init) => {
    url = String(input); authorization = new Headers(init?.headers).get('authorization') || '';
    return new Response('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  });
  const chunks: string[] = [];
  for await (const chunk of provider.stream([{ role: 'user', content: 'hi' }], 'general', new AbortController().signal)) chunks.push(chunk);
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(authorization, 'Bearer server-secret');
  assert.deepEqual(chunks, ['Hello ', 'there']);
  assert.equal(mapOpenRouterFailure(429).code, 'rate_limited');
  assert.equal(mapOpenRouterFailure(402).code, 'billing_required');
});

test('OpenRouter response errors are surfaced without paid fallback', async () => {
  const provider = new OpenRouterProvider('private', 'free/text-model', async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }));
  await assert.rejects(async () => {
    for await (const _chunk of provider.stream([{ role: 'user', content: 'hello' }], 'general', new AbortController().signal)) { /* consume */ }
  }, (error: unknown) => error instanceof ProviderError && error.code === 'rate_limited');
});
