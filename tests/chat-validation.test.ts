import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatRequest, validateConversationTitle } from '../src/lib/ai/chat-validation';

const valid = { conversationId: 'b3af72dc-1f73-4e86-8fb1-c62c950c31ad', message: '  Review this setup  ', mode: 'trading-coach', provider: 'gemini', model: 'gemini-test' };

test('chat request trims a valid message and applies mode/provider', () => {
  assert.deepEqual(validateChatRequest(valid), { ...valid, message: 'Review this setup', model: 'gemini-test', retry: false });
});

test('chat request rejects empty and oversized messages', () => {
  assert.equal(validateChatRequest({ ...valid, message: '  ' }), null);
  assert.equal(validateChatRequest({ ...valid, message: 'x'.repeat(12001) }), null);
});

test('chat request rejects malformed ids, unsupported providers, and modes', () => {
  assert.equal(validateChatRequest({ ...valid, conversationId: 'not-a-uuid' }), null);
  assert.equal(validateChatRequest({ ...valid, provider: 'deepseek' }), null);
  assert.equal(validateChatRequest({ ...valid, provider: 'openrouter', model: 'org/model:free' })?.model, 'org/model:free');
  assert.equal(validateChatRequest({ ...valid, model: 'invalid model' }), null);
  assert.equal(validateChatRequest({ ...valid, mode: 'invented' }), null);
});

test('chat SMC tool request accepts constrained market inputs and rejects malformed selections', () => {
  const parsed = validateChatRequest({ ...valid, smcRequest: { symbol: 'btcusdt', category: 'linear', timeframe: '30' } });
  assert.deepEqual(parsed?.smcRequest, { symbol: 'BTCUSDT', category: 'linear', timeframe: '30' });
  assert.equal(validateChatRequest({ ...valid, smcRequest: { symbol: 'BTC/USDT', category: 'linear', timeframe: '60' } }), null);
  assert.equal(validateChatRequest({ ...valid, smcRequest: { symbol: 'BTCUSDT', category: 'fake', timeframe: '60' } }), null);
  assert.equal(validateChatRequest({ ...valid, smcRequest: { symbol: 'BTCUSDT', category: 'linear', timeframe: '5' } }), null);
});

test('chat accepts only bounded PNG, JPEG, and WebP image data for OpenRouter', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validateChatRequest({ ...valid, provider: 'openrouter', model: 'vision/model:free', imageDataUrl: png })?.image?.mimeType, 'image/png');
  assert.equal(validateChatRequest({ ...valid, provider: 'gemini', imageDataUrl: png }), null);
  assert.equal(validateChatRequest({ ...valid, provider: 'openrouter', imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), null);
  assert.equal(validateChatRequest({ ...valid, provider: 'openrouter', imageDataUrl: 'data:image/jpeg;base64,iVBORw0KGgo=' }), null);
  const oversized = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
  assert.equal(validateChatRequest({ ...valid, provider: 'openrouter', imageDataUrl: `data:image/png;base64,${oversized}` }), null);
});

test('conversation title bounds are enforced', () => {
  assert.equal(validateConversationTitle('  My chart review '), 'My chart review');
  assert.equal(validateConversationTitle(''), null);
  assert.equal(validateConversationTitle('x'.repeat(121)), null);
});
