import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignHigherTimeframeCandles, analyzeMultiTimeframe, analyzeTimeframe, type OHLCV, validateCandles } from '../src/lib/smc/engine';

const minute = 60_000;
const base = Date.UTC(2026, 0, 1);
function bars(highs: number[], lows: number[], opts: { opens?: number[]; closes?: number[]; start?: number; step?: number; closed?: boolean[] } = {}): OHLCV[] {
  return highs.map((high, i) => ({ timestamp: (opts.start ?? base) + i * (opts.step ?? minute), open: opts.opens?.[i] ?? (high + lows[i]) / 2, high, low: lows[i], close: opts.closes?.[i] ?? (high + lows[i]) / 2, volume: 10, closed: opts.closed?.[i] ?? true }));
}
const common = { now: base + 20 * minute, maxDataAgeMs: 60 * minute, swingLeft: 1, swingRight: 1 };

describe('deterministic SMC engine', () => {
  it('detects a swing only after right-side confirmation bars exist', () => {
    const candles = bars([10,12,9,11], [5,7,4,6]);
    const result = analyzeTimeframe(candles, 'BTCUSDT', '1', common);
    const swing = result.swings.find((item) => item.kind === 'high' && item.index === 1);
    assert.ok(swing);
    assert.equal(swing.confirmedAt, candles[2].timestamp);
    assert.equal(swing.confirmed, true);
    const partial = analyzeTimeframe(candles.slice(0,2), 'BTCUSDT', '1', common);
    assert.equal(partial.swings.some((item) => item.index === 1 && item.confirmed), false);
  });

  it('classifies HH, HL, LH, and LL against the prior confirmed swing of the same side', () => {
    const highSeries = analyzeTimeframe(bars([10,12,9,11,8,13,9], [4,5,6,5,4,5,6]), 'BTC', '1', common);
    assert.deepEqual(highSeries.swings.filter((s) => s.kind === 'high').map((s) => s.label), [undefined, 'LH', 'HH']);
    const lowSeries = analyzeTimeframe(bars([10,11,12,11,10,12,11], [7,6,8,5,8,7,9]), 'BTC', '1', common);
    assert.deepEqual(lowSeries.swings.filter((s) => s.kind === 'low').map((s) => s.label), [undefined, 'LL', 'HL']);
  });

  it('detects a close-confirmed BOS and records swing and candle evidence', () => {
    const candles = bars([10,12,9,13], [5,7,4,6], { closes: [8,10,8,12.5] });
    const result = analyzeTimeframe(candles, 'BTCUSDT', '1', common);
    const event = result.structureBreaks.find((item) => item.candleIndex === 3);
    assert.ok(event);
    assert.equal(event.kind, 'BOS');
    assert.equal(event.direction, 'bullish');
    assert.equal(event.confirmationMethod, 'close');
    assert.equal(event.price, 12);
    assert.equal(event.confirmed, true);
    assert.equal(event.timestamp, candles[3].timestamp);
  });

  it('does not backdate a historical break before its swing confirmation was available', () => {
    const candles = bars([10,12,9,13], [5,7,4,6], { closes: [8,10,8,12.5] });
    const asOfBeforeConfirmation = analyzeTimeframe(candles.slice(0, 2), 'BTC', '1', common);
    assert.equal(asOfBeforeConfirmation.structureBreaks.length, 0);
    const fullHistory = analyzeTimeframe(candles, 'BTC', '1', common);
    const event = fullHistory.structureBreaks.find((item) => item.candleIndex === 3);
    assert.ok(event);
    assert.ok(event.timestamp > fullHistory.swings.find((item) => item.index === 1 && item.kind === 'high')!.confirmedAt);
  });

  it('uses close-versus-wick rules explicitly for break confirmation', () => {
    const candles = bars([10,12,9,13], [5,7,4,6], { opens: [8,9,6,10], closes: [8,10,7,11.5] });
    const closed = analyzeTimeframe(candles, 'BTC', '1', common);
    const wick = analyzeTimeframe(candles, 'BTC', '1', { ...common, breakMethod: 'wick' });
    assert.equal(closed.structureBreaks.some((event) => event.candleIndex === 3 && event.direction === 'bullish'), false);
    assert.equal(wick.structureBreaks.some((event) => event.candleIndex === 3 && event.direction === 'bullish'), true);
  });

  it('detects CHoCH against established bullish structure, only after the swing is confirmed', () => {
    const candles = bars([10,12,9,11,10,14,12,13,11], [5,7,6,8,7,9,8,6,4], { closes: [8,10,7.5,9,8.5,12,10,6.5,6] });
    const result = analyzeTimeframe(candles, 'BTC', '1', common);
    const event = result.structureBreaks.find((item) => item.candleIndex === 7 && item.direction === 'bearish');
    assert.ok(event);
    assert.equal(event.kind, 'CHoCH');
    assert.ok(event.timestamp > result.swings.find((s) => s.kind === 'low' && s.index === 4)!.confirmedAt);
  });

  it('groups equal highs and observes a breach separately from reversal confirmation', () => {
    const candles = bars([10,12,9,12,9,13], [5,7,4,6,4.5,8], { closes: [8,10,7,10,7,11] });
    const result = analyzeTimeframe(candles, 'BTC', '1', { ...common, equalTolerancePct: 0.001 });
    const pool = result.liquidityPools.find((item) => item.kind === 'high' && item.equal);
    assert.ok(pool);
    assert.equal(pool.touches, 2);
    const sweep = result.sweeps.find((item) => item.kind === 'high');
    assert.ok(sweep);
    assert.equal(sweep.breached, true);
    assert.equal(sweep.rejectionObserved, true);
    assert.equal(sweep.reversalConfirmedAt, null);
    assert.match(sweep.explanation, /does not establish institutional intent/);
    const lows = bars([14,12,13,11,12,10], [8,6,9,6,9,5], { closes: [10,8,11,8,10,8] });
    const lowResult = analyzeTimeframe(lows, 'BTC', '1', common);
    assert.ok(lowResult.liquidityPools.some((item) => item.kind === 'low' && item.equal));
    assert.ok(lowResult.sweeps.some((item) => item.kind === 'low' && item.rejectionObserved));
  });

  it('detects bullish FVGs and tracks untouched, partial, full, and invalidation states', () => {
    const first = bars([10,13,14], [8,9,12]);
    assert.equal(analyzeTimeframe(first, 'BTC', '1', common).fvgs[0].status, 'untouched');
    const partial = bars([10,13,14,13], [8,9,12,11.5]);
    assert.equal(analyzeTimeframe(partial, 'BTC', '1', common).fvgs[0].status, 'partially-filled');
    const filled = bars([10,13,14,12], [8,9,12,9.5]);
    assert.equal(analyzeTimeframe(filled, 'BTC', '1', common).fvgs[0].status, 'filled');
    const invalid = bars([10,13,14,11], [8,9,12,8], { closes: [9,11,13,9.5] });
    assert.equal(analyzeTimeframe(invalid, 'BTC', '1', common).fvgs[0].status, 'invalidated');
    const bearish = bars([12,11,9], [10,8,7]);
    assert.equal(analyzeTimeframe(bearish, 'BTC', '1', common).fvgs[0].direction, 'bearish');
  });

  it('replays at an as-of time without using later FVG fills or break candles', () => {
    const candles = bars([10,13,14,12], [8,9,12,9.5], { closes: [9,11,13,10.5] });
    const hindsight = analyzeTimeframe(candles, 'BTC', '1', common);
    assert.equal(hindsight.fvgs[0].status, 'filled');
    const asOf = analyzeTimeframe(candles, 'BTC', '1', { ...common, asOfTimestamp: candles[2].timestamp + minute });
    assert.equal(asOf.fvgs[0].status, 'untouched');
    assert.equal(asOf.lastCandleTimestamp, candles[2].timestamp);
  });

  it('requires close break, displacement, and a preceding opposing candle for an OB candidate', () => {
    const candles = bars([9,11,10,13], [7,8,8,9], { opens: [8.5,9,9.5,9.2], closes: [8,10,8.5,12.8] });
    const result = analyzeTimeframe(candles, 'BTC', '1', common);
    assert.equal(result.orderBlocks.length, 1);
    assert.equal(result.orderBlocks[0].sourceCandleTimestamp, candles[2].timestamp);
    assert.equal(result.orderBlocks[0].status, 'unmitigated');
    assert.match(result.orderBlocks[0].explanation, /confirmed close-based structure break/);
    const mitigated = analyzeTimeframe([...candles, { ...candles[3], timestamp: candles[3].timestamp + minute, low: 9, high: 11, open: 9.5, close: 10 }], 'BTC', '1', { ...common, now: base + 21 * minute });
    assert.equal(mitigated.orderBlocks[0].status, 'mitigated');
    const invalidated = analyzeTimeframe([...candles, { ...candles[3], timestamp: candles[3].timestamp + minute, low: 7, high: 9, open: 8.5, close: 7.5 }], 'BTC', '1', { ...common, now: base + 21 * minute });
    assert.equal(invalidated.orderBlocks[0].status, 'invalidated');
  });

  it('excludes forming candles by default and keeps their break findings provisional when opted in', () => {
    const candles = bars([10,12,9,13], [5,7,4,6], { closes: [8,10,8,12.5], closed: [true,true,true,false] });
    const excluded = analyzeTimeframe(candles, 'BTC', '1', common);
    assert.equal(excluded.dataQuality.excludedFormingCandles, 1);
    assert.equal(excluded.structureBreaks.some((item) => item.candleIndex === 3), false);
    const included = analyzeTimeframe(candles, 'BTC', '1', { ...common, includeForming: true });
    assert.equal(included.structureBreaks.find((item) => item.candleIndex === 3)?.confirmed, false);
  });

  it('rejects malformed, duplicate, unordered, and missing candles and flags stale data', () => {
    const good = bars([10,11,10], [5,6,4]);
    assert.equal(validateCandles([{ ...good[0], low: 12 }, ...good.slice(1)], '1', common).quality.valid, false);
    assert.equal(validateCandles([{ ...good[0], timestamp: good[0].timestamp + 1 }], '1', common).quality.valid, false);
    assert.equal(validateCandles([good[0], good[0]], '1', common).quality.valid, false);
    assert.equal(validateCandles([good[1], good[0]], '1', common).quality.valid, false);
    const missing = [good[0], { ...good[2], timestamp: good[0].timestamp + 3 * minute }];
    assert.equal(validateCandles(missing, '1', common).quality.missingCandles, 2);
    assert.equal(validateCandles(missing, '1', common).quality.valid, false);
    assert.equal(validateCandles(good, '1', { ...common, now: base + 10 * 86_400_000 }).quality.stale, true);
  });

  it('aligns only fully closed higher-timeframe candles at the lower candle timestamp', () => {
    const day0 = Date.UTC(2026, 0, 1), day1 = day0 + 86_400_000;
    const higher = bars([10,11], [5,6], { start: day0, step: 86_400_000, closed: [true,true] });
    const lower = bars([8,9], [4,5], { start: day0 + 3 * 3_600_000, step: 21 * 3_600_000 });
    const aligned = alignHigherTimeframeCandles(lower, higher, 'D');
    assert.equal(aligned[0].higherCandleTimestamp, null);
    assert.equal(aligned[1].higherCandleTimestamp, day0);
    assert.equal(aligned[1].higherCandleClosed, true);
    assert.equal(day1, lower[1].timestamp);
  });

  it('returns a structured multi-timeframe assessment and blocks qualification on stale inputs', () => {
    const flat = (start: number, step: number, count: number): OHLCV[] => Array.from({ length: count }, (_, i) => ({ timestamp: start + i * step, open: 10, high: 11, low: 9, close: 10, volume: 1, closed: true }));
    const assessment = analyzeMultiTimeframe({ symbol: 'BTCUSDT', timeframe: '60', candles: { daily: flat(base, 86_400_000, 3), fourHour: flat(base, 4 * 3_600_000, 6), oneHour: flat(base, 3_600_000, 24), thirtyMinute: flat(base, 30 * minute, 48) }, options: { now: base + 3 * 86_400_000, maxDataAgeMs: 10 * 86_400_000, swingLeft: 1, swingRight: 1 } });
    assert.equal(assessment.state, 'Watch');
    assert.equal(assessment.symbol, 'BTCUSDT');
    assert.ok(Array.isArray(assessment.requiredConfirmation));
    const stale = analyzeMultiTimeframe({ symbol: 'BTC', timeframe: '60', candles: { daily: flat(base, 86_400_000, 3), fourHour: flat(base, 4 * 3_600_000, 6), oneHour: flat(base, 3_600_000, 24), thirtyMinute: flat(base, 30 * minute, 48) }, options: { now: base + 50 * 86_400_000, maxDataAgeMs: 10 * 86_400_000, swingLeft: 1, swingRight: 1 } });
    assert.equal(stale.dataQuality.stale, true);
    assert.equal(stale.state, 'Watch');
  });
});
