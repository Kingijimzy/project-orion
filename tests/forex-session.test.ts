import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getForexSessionState } from '../src/lib/market/forex-session';

describe('indicative forex session schedule', () => {
  it('uses New York time for the Sunday open and Saturday close across daylight saving', () => {
    assert.equal(getForexSessionState(new Date('2026-01-04T22:04:00Z')), 'closed'); // 17:04 EST
    assert.equal(getForexSessionState(new Date('2026-01-04T22:05:00Z')), 'open'); // 17:05 EST
    assert.equal(getForexSessionState(new Date('2026-07-05T21:05:00Z')), 'open'); // 17:05 EDT
    assert.equal(getForexSessionState(new Date('2026-07-04T18:00:00Z')), 'closed'); // Saturday EDT
  });

  it('distinguishes the scheduled daily break from weekend closure', () => {
    assert.equal(getForexSessionState(new Date('2026-01-05T21:58:00Z')), 'open'); // Monday 16:58 EST
    assert.equal(getForexSessionState(new Date('2026-01-05T21:59:00Z')), 'daily-break'); // Monday 16:59 EST
    assert.equal(getForexSessionState(new Date('2026-01-05T22:04:00Z')), 'daily-break'); // Monday 17:04 EST
    assert.equal(getForexSessionState(new Date('2026-01-05T22:05:00Z')), 'open'); // Monday 17:05 EST
    assert.equal(getForexSessionState(new Date('2026-01-09T21:58:00Z')), 'open'); // Friday 16:58 EST
    assert.equal(getForexSessionState(new Date('2026-01-09T21:59:00Z')), 'closed'); // Friday 16:59 EST
  });

  it('rejects invalid dates instead of guessing a session state', () => {
    assert.throws(() => getForexSessionState(new Date(Number.NaN)), /valid date/i);
  });
});
