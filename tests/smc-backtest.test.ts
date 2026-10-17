import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTradeOutcome, runBacktest, type BacktestCandles } from '../src/lib/smc/backtest';
import type { OHLCV } from '../src/lib/smc/engine';

const candle = (timestamp: number, low: number, high: number): OHLCV => ({ timestamp, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1, closed: true });

test('resolveTradeOutcome honours target, stop, expiry, open, and the pessimistic same-candle rule', () => {
  assert.deepEqual(resolveTradeOutcome('long', 100, 98, 104, [candle(1, 99, 103), candle(2, 97, 102)], 60), { outcome: 'stop', rMultiple: -1, barsHeld: 2 });
  assert.deepEqual(resolveTradeOutcome('long', 100, 98, 104, [candle(1, 99, 104.5)], 60), { outcome: 'target', rMultiple: 2, barsHeld: 1 });
  assert.deepEqual(resolveTradeOutcome('long', 100, 98, 104, [candle(1, 97, 105)], 60), { outcome: 'stop', rMultiple: -1, barsHeld: 1 });
  assert.deepEqual(resolveTradeOutcome('short', 100, 102, 96, [candle(1, 97, 101), candle(2, 95, 102)], 60), { outcome: 'stop', rMultiple: -1, barsHeld: 2 });
  assert.deepEqual(resolveTradeOutcome('short', 100, 102, 96, [candle(1, 96, 101)], 60), { outcome: 'target', rMultiple: 2, barsHeld: 1 });
  assert.deepEqual(resolveTradeOutcome('long', 100, 98, 104, [candle(1, 99, 103), candle(2, 99, 103)], 2), { outcome: 'expired', rMultiple: 0, barsHeld: 2 });
  assert.deepEqual(resolveTradeOutcome('long', 100, 98, 104, [candle(1, 99, 103)], 60), { outcome: 'open', rMultiple: null, barsHeld: 1 });
});

function zigzag(startMs: number, stepMs: number, count: number, base: number, amplitude: number, drift: number): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const phase = Math.sin(index / 3) * amplitude;
    const mid = base + drift * index + phase;
    const open = mid - 0.2;
    const close = mid + 0.2;
    return { timestamp: startMs + index * stepMs, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 10 + index, closed: true };
  });
}

function syntheticCandles(): BacktestCandles {
  const day = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  const daily = zigzag(start, day, 120, 100, 3, 0.15);
  const fourHour = zigzag(start, 4 * 3_600_000, 240, 100, 2, 0.06);
  const oneHour = zigzag(start, 3_600_000, 500, 100, 1.5, 0.03);
  const thirtyMinute = zigzag(start, 1_800_000, 500, 100, 1, 0.015);
  return { daily, fourHour, oneHour, thirtyMinute };
}

test('runBacktest produces a bounded, internally consistent replay report', () => {
  const report = runBacktest({ symbol: 'BTCUSDT', timeframe: '60', candles: syntheticCandles(), options: { now: Date.UTC(2026, 6, 1) } });
  assert.equal(report.source, 'deterministic-replay');
  assert.equal(report.symbol, 'BTCUSDT');
  assert.ok(report.evaluationPoints > 0);
  assert.equal(report.trades.length, report.totals.signals);
  assert.equal(report.totals.target + report.totals.stop + report.totals.expired + report.totals.open, report.totals.actionable);
  const stateSum = Object.values(report.byState).reduce((sum, value) => sum + value, 0);
  assert.equal(stateSum, report.evaluationPoints);
  assert.ok(report.totals.winRate === null || (report.totals.winRate >= 0 && report.totals.winRate <= 1));
  assert.ok(report.caveats.length >= 4);
  assert.ok(report.evaluationPoints <= report.engineInput.maxEvaluations);
});

test('runBacktest reports no rate when there is nothing to evaluate', () => {
  const empty: BacktestCandles = { daily: [], fourHour: [], oneHour: [], thirtyMinute: [] };
  const report = runBacktest({ symbol: 'BTCUSDT', timeframe: '60', candles: empty });
  assert.equal(report.evaluationPoints, 0);
  assert.equal(report.totals.signals, 0);
  assert.equal(report.totals.winRate, null);
  assert.equal(report.totals.expectancyR, null);
  assert.ok(report.caveats.some((caveat) => caveat.includes('No candles were available')));
});
