import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { microphoneFailureMessage, requestMicrophoneAccess } from '../src/lib/voice/microphone';

describe('microphone preflight', () => {
  it('reports unsupported when no mediaDevices API is available', async () => {
    assert.deepEqual(await requestMicrophoneAccess(null), { ok: false, reason: 'unsupported' });
    assert.deepEqual(await requestMicrophoneAccess({}), { ok: false, reason: 'unsupported' });
  });

  it('grants and immediately releases the preflight stream', async () => {
    let stopped = 0;
    const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }, { stop: () => { stopped += 1; } }] } as unknown as MediaStream;
    const result = await requestMicrophoneAccess({ getUserMedia: async () => stream });
    assert.deepEqual(result, { ok: true });
    assert.equal(stopped, 2);
  });

  it('distinguishes a blocked permission from a missing device', async () => {
    const denied = await requestMicrophoneAccess({ getUserMedia: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); } });
    assert.deepEqual(denied, { ok: false, reason: 'denied' });
    const missing = await requestMicrophoneAccess({ getUserMedia: async () => { throw Object.assign(new Error('none'), { name: 'NotFoundError' }); } });
    assert.deepEqual(missing, { ok: false, reason: 'unavailable' });
  });

  it('maps each failure to actionable guidance without promising voice works', () => {
    assert.match(microphoneFailureMessage('denied'), /blocked/i);
    assert.match(microphoneFailureMessage('unavailable'), /microphone/i);
    assert.match(microphoneFailureMessage('unsupported'), /text chat/i);
  });
});
