import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarios } from '../src/lib/smc/scenarios';
import type { LiquidityPool, SMCAssessment, TimeframeAnalysis, Trend } from '../src/lib/smc/engine';

const timeframe = (over: Partial<TimeframeAnalysis> = {}): TimeframeAnalysis => ({
  symbol: 'BTCUSDT', timeframe: '60', analysisTimestamp: 1, lastCandleTimestamp: 1, lastCandleClosed: true,
  dataQuality: { valid: true, stale: false, missingCandles: 0, excludedFormingCandles: 0, issues: [], lastCandleTimestamp: 1, lastCandleClosed: true },
  swings: [], structure: 'neutral', structureBreaks: [], liquidityPools: [], sweeps: [], fvgs: [], orderBlocks: [], ...over,
});
const pool = (kind: LiquidityPool['kind'], level: number): LiquidityPool => ({ kind, level, touches: 2, swingTimestamps: [1, 2], createdAt: 2, equal: true });
function assessment(over: Partial<SMCAssessment> = {}): SMCAssessment {
  return {
    symbol: 'BTCUSDT', analysisTimestamp: 1, timeframe: '60', state: 'Qualified',
    higherTimeframeBias: 'bullish', dailyBias: 'bullish', fourHourBias: 'bullish', lowerTimeframeStructure: 'bullish',
    structure: timeframe({ structure: 'bullish' }), higherTimeframes: { daily: timeframe({ timeframe: 'D' }), fourHour: timeframe({ timeframe: '240' }) },
    alignedCandles: [], relevantLiquidity: [], fvgs: [], orderBlocks: [],
    supportingEvidence: ['Daily and 4H align bullish.'], conflictingEvidence: [], requiredConfirmation: ['Wait for a confirmed bullish close-based structure break.'],
    invalidationConditions: ['Bullish thesis invalidates on a confirmed close break below the latest opposing swing at 90.'], dataQuality: { valid: true, stale: false, issues: [] }, qualificationRule: 'rules', ...over,
  };
}

test('a bullish assessment yields a bias-aligned primary scenario with engine-sourced targets above price', () => {
  const pools = [pool('high', 110), pool('high', 105), pool('high', 95), pool('low', 88)];
  const report = buildScenarios({ analysis: assessment({ relevantLiquidity: pools }), lastPrice: 100 });
  const primary = report.scenarios.find((scenario) => scenario.kind === 'primary');
  assert.ok(primary);
  assert.equal(primary.direction, 'bullish');
  assert.deepEqual(primary.targets.map((target) => target.price), [105, 110]);
  assert.ok(report.scenarios.every((scenario) => scenario.targets.every((target) => pools.some((entry) => entry.level === target.price) || target.source.includes('swing'))));
  assert.equal(report.scenarios.some((scenario) => scenario.kind === 'neutral'), false);
  assert.ok(report.notes.some((note) => note.includes('not probabilities')));
});

test('a neutral bias produces only a wait/neutral scenario and never a primary setup', () => {
  const report = buildScenarios({ analysis: assessment({ higherTimeframeBias: 'neutral', dailyBias: 'neutral', fourHourBias: 'neutral', state: 'Watch' }), lastPrice: 100 });
  assert.equal(report.scenarios.some((scenario) => scenario.kind === 'primary'), false);
  assert.equal(report.scenarios.filter((scenario) => scenario.kind === 'neutral').length, 1);
});

test('conflicting evidence adds a counter-bias alternative and missing price is stated, not fabricated', () => {
  const report = buildScenarios({ analysis: assessment({ conflictingEvidence: ['Lower-timeframe structure is bearish against bullish bias.'], relevantLiquidity: [pool('low', 80)] }), lastPrice: null });
  assert.ok(report.scenarios.some((scenario) => scenario.kind === 'alternative' && scenario.direction === 'bearish'));
  assert.ok(report.notes.some((note) => note.includes('No current price')));
  const allTargets = report.scenarios.flatMap((scenario) => scenario.targets);
  assert.ok(allTargets.every((target) => target.price === 80 || target.source.includes('swing')));
});

test('historical base rate is passed through as labelled context only', () => {
  const report = buildScenarios({ analysis: assessment(), lastPrice: 100, historicalContext: { resolved: 41, winRate: 0.29, averageR: -0.09, riskReward: 2 } });
  assert.deepEqual(report.historicalContext, { resolved: 41, winRate: 0.29, averageR: -0.09, riskReward: 2 });
});
