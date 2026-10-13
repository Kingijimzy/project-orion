import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiConfiguration, geminiEndpoint, GeminiProvider, mapGeminiFailure, ProviderError } from '../src/lib/ai/provider';

test('Gemini configuration permits only the verified free-tier model while paid access is disabled', () => {
  assert.equal(geminiConfiguration({ GEMINI_API_KEY: 'key', GEMINI_MODEL: 'model', GEMINI_ALLOW_PAID_MODEL: 'false' } as unknown as NodeJS.ProcessEnv), null);
  assert.deepEqual(geminiConfiguration({ GEMINI_API_KEY: ' key ', GEMINI_MODEL: 'gemini-3.1-flash-lite', GEMINI_ALLOW_PAID_MODEL: 'false' } as unknown as NodeJS.ProcessEnv), { apiKey: 'key', model: 'gemini-3.1-flash-lite', allowPaid: false });
  assert.deepEqual(geminiConfiguration({ GEMINI_API_KEY: ' key ', GEMINI_MODEL: 'gemini-test', GEMINI_ALLOW_PAID_MODEL: 'true' } as unknown as NodeJS.ProcessEnv), { apiKey: 'key', model: 'gemini-test', allowPaid: true });
});

test('Gemini adapter uses the SSE endpoint and streams text without exposing auth in the URL', async () => {
  let capturedUrl = '';
  let capturedHeaders: HeadersInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = init?.headers;
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"Orion"}]}}]}\n', { status: 200 });
  };
  const provider = new GeminiProvider({ apiKey: 'secret-value', model: 'gemini-test', allowPaid: true }, fetcher);
  const chunks: string[] = [];
  for await (const chunk of provider.stream([{ role: 'user', content: 'Hi' }], 'general', new AbortController().signal)) chunks.push(chunk);
  assert.equal(capturedUrl, geminiEndpoint('gemini-test'));
  assert.equal(capturedUrl.includes('secret-value'), false);
  assert.equal(new Headers(capturedHeaders).get('x-goog-api-key'), 'secret-value');
  assert.deepEqual(chunks, ['Hello ', 'Orion']);
});

test('Gemini rate limits are translated to actionable provider errors', () => {
  const error = mapGeminiFailure(429);
  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'rate_limited');
  assert.match(error.message, /quota or rate limit/);
});

test('provider health validates key and model without generating model output', async () => {
  const { checkGeminiStatus } = await import('../src/lib/ai/provider');
  let requestedUrl = '';
  let requestedKey = '';
  const status = await checkGeminiStatus({ GEMINI_API_KEY: 'private', GEMINI_MODEL: 'gemini-test', GEMINI_ALLOW_PAID_MODEL: 'true' } as unknown as NodeJS.ProcessEnv, async (input, init) => {
    requestedUrl = String(input); requestedKey = new Headers(init?.headers).get('x-goog-api-key') || '';
    return new Response('{"name":"models/gemini-test","supportedGenerationMethods":["generateContent"]}', { status: 200 });
  });
  assert.equal(status.configured, true);
  assert.equal(status.paidUseEnabled, true);
  assert.equal(requestedUrl.endsWith('/models/gemini-test'), true);
  assert.equal(requestedUrl.includes('private'), false);
  assert.equal(requestedKey, 'private');
});
