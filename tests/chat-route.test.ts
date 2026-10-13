import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/chat/route';

const request = (body: string) => new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('chat route rejects malformed JSON without attempting auth or provider access', async () => {
  const response = await POST(request('{'));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_request');
});

test('chat route rejects empty messages and unsupported provider requests', async () => {
  const empty = await POST(request(JSON.stringify({ conversationId: 'b3af72dc-1f73-4e86-8fb1-c62c950c31ad', message: '  ', provider: 'gemini', model: 'gemini-test', mode: 'general' })));
  assert.equal(empty.status, 400);
  const unsupported = await POST(request(JSON.stringify({ conversationId: 'b3af72dc-1f73-4e86-8fb1-c62c950c31ad', message: 'Hello', provider: 'deepseek', model: 'deepseek-test', mode: 'general' })));
  assert.equal(unsupported.status, 400);
});

test('chat route rejects request bodies above the byte limit', async () => {
  const response = await POST(request(JSON.stringify({ message: 'x'.repeat(40_000) })));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'request_too_large');
});
