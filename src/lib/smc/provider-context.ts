/**
 * Builds the fixed, JSON-serialisable context handed to the AI for the deterministic SMC tool.
 * It contains only engine output and the authenticated user's selected strategy profile settings.
 * Scenarios are included as conditional rule descriptions; no probability or confidence is added.
 */
import type { OHLCV, SMCAssessment } from './engine';
import { buildScenarios } from './scenarios';
import type { StrategySettings } from './strategy-profile';

export type SmcProviderResult = {
  analysis: SMCAssessment;
  lastSuccessfulUpdate: string;
  source: string;
  candles: { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] };
};
export type SmcProviderProfile = { name: string; version: number; settings: StrategySettings };

export function buildSmcProviderContext(result: SmcProviderResult, profile: SmcProviderProfile) {
  const analysis = result.analysis;
  const reduceTimeframe = (item: SMCAssessment['structure']) => ({
    timeframe: item.timeframe, structure: item.structure, lastCandleTimestamp: item.lastCandleTimestamp, lastCandleClosed: item.lastCandleClosed, dataQuality: item.dataQuality,
    swings: item.swings.slice(-12), structureBreaks: item.structureBreaks.slice(-10), liquidityPools: item.liquidityPools.slice(-10), sweeps: item.sweeps.slice(-8), fvgs: item.fvgs.slice(-12), orderBlocks: item.orderBlocks.slice(-12),
  });
  const selectedSeries = analysis.timeframe === '30' ? result.candles.thirtyMinute : result.candles.oneHour;
  const lastPrice = [...selectedSeries].reverse().find((candle) => candle.closed !== false)?.close ?? null;
  const scenarios = buildScenarios({ analysis, lastPrice });
  return {
    source: result.source, lastSuccessfulUpdate: result.lastSuccessfulUpdate,
    strategyProfile: { name: profile.name, version: profile.version, settings: profile.settings },
    scenarios: scenarios.scenarios, scenarioNotes: scenarios.notes,
    analysis: {
      symbol: analysis.symbol, timeframe: analysis.timeframe, analysisTimestamp: analysis.analysisTimestamp, state: analysis.state,
      higherTimeframeBias: analysis.higherTimeframeBias, dailyBias: analysis.dailyBias, fourHourBias: analysis.fourHourBias, lowerTimeframeStructure: analysis.lowerTimeframeStructure,
      higherTimeframes: { daily: reduceTimeframe(analysis.higherTimeframes.daily), fourHour: reduceTimeframe(analysis.higherTimeframes.fourHour) },
      structure: reduceTimeframe(analysis.structure), alignedCandles: analysis.alignedCandles.slice(-8), relevantLiquidity: analysis.relevantLiquidity,
      fvgs: analysis.fvgs.slice(-12), orderBlocks: analysis.orderBlocks.slice(-12), supportingEvidence: analysis.supportingEvidence,
      conflictingEvidence: analysis.conflictingEvidence, requiredConfirmation: analysis.requiredConfirmation,
      invalidationConditions: analysis.invalidationConditions, dataQuality: analysis.dataQuality, qualificationRule: analysis.qualificationRule,
    },
  };
}
