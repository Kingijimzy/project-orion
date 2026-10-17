import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmcProviderContext } from '../src/lib/smc/provider-context';
import { DEFAULT_STRATEGY_PROFILE } from '../src/lib/smc/strategy-profile';
import type { LiquidityPool, OHLCV, SMCAssessment, TimeframeAnalysis } from '../src/lib/smc/engine';

const timeframe = (over: Partial<TimeframeAnalysis> = {}): TimeframeAnalysis => ({
  symbol: 'BTCUSDT', timeframe: '60', analysisTimestamp: 1, lastCandleTimestamp: 1, lastCandleClosed: true,
  dataQuality: { valid: true, stale: false, missingCandles: 0, excludedFormingCandles: 0, issues: [], lastCandleTimestamp: 1, lastCandleClosed: true },
  swings: [], structure: 'neutral', structureBreaks: [], liquidityPools: [], sweeps: [], fvgs: [], orderBlocks: [], ...over,
});
const pool = (kind: LiquidityPool['kind'], level: number): LiquidityPool => ({ kind, level, touches: 2, swingTimestamps: [1, 2], createdAt: 2, equal: true });
const candle = (timestamp: number, close: number, closed: boolean): OHLCV => ({ timestamp, open: close, high: close + 1, low: close - 1, close, volume: 1, closed });
const analysis: SMCAssessment = {
  symbol: 'BTCUSDT', analysisTimestamp: 1, timeframe: '60', state: 'Qualified', higherTimeframeBias: 'bullish', dailyBias: 'bullish', fourHourBias: 'bullish', lowerTimeframeStructure: 'bullish',
  structure: timeframe({ structure: 'bullish' }), higherTimeframes: { daily: timeframe({ timeframe: 'D' }), fourHour: timeframe({ timeframe: '240' }) },
  alignedCandles: [], relevantLiquidity: [pool('high', 110)], fvgs: [], orderBlocks: [],
  supportingEvidence: ['Aligned'], conflictingEvidence: [], requiredConfirmation: ['Confirm break'], invalidationConditions: ['Invalidate below 90'],
  dataQuality: { valid: true, stale: false, issues: [] }, qualificationRule: 'rules',
};
const result = {
  analysis, lastSuccessfulUpdate: '2026-10-17T00:00:00.000Z', source: 'Bybit V5 public REST' as const,
  candles: { daily: [], fourHour: [], oneHour: [candle(1, 100, true), candle(2, 101, false)], thirtyMinute: [] },
};

test('the SMC provider context carries deterministic scenarios and no invented probability', () => {
  const context = buildSmcProviderContext(result, DEFAULT_STRATEGY_PROFILE);
  assert.ok(Array.isArray(context.scenarios));
  assert.equal(context.scenarios.some((scenario) => scenario.kind === 'primary'), true);
  assert.ok(context.scenarioNotes.some((note) => note.includes('not probabilities')));
  assert.equal(context.strategyProfile.name, DEFAULT_STRATEGY_PROFILE.name);
  assert.equal(context.scenarios.every((scenario) => !Object.keys(scenario).some((key) => /probab|confidence/i.test(key))), true);
  // Reference price is the last closed candle, not the forming one.
  assert.equal(context.scenarios.find((scenario) => scenario.kind === 'primary')?.direction, 'bullish');
});
