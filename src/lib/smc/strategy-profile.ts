import type { BreakMethod, EngineOptions } from './engine';

export type StrategySettings = {
  swingLeft: number; swingRight: number; equalTolerancePct: number; breakMethod: BreakMethod;
  fvg: { enabled: boolean; minimumGapPct: number; fillMethod: 'wick' | 'close' };
  orderBlock: { enabled: boolean; lookback: number; minimumDisplacementBodyRatio: number; zone: 'full-candle' | 'body'; mitigation: 'touch' | 'midpoint' | 'close-through'; invalidation: 'close' | 'wick' };
  multiTimeframe: { requireDailyFourHourAlignment: boolean; requireLowerTimeframeAlignment: boolean; requireSweep: boolean; requireStructureBreak: boolean; requireZoneRetest: boolean; maximumCandidateBars: number };
  minimumConfluence: number;
};
export type StrategyProfile = { id: string; name: string; version: number; settings: StrategySettings; isDefault?: boolean; is_selected?: boolean };
export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = {
  id: 'orion-baseline', name: 'Orion Baseline', version: 1, isDefault: true,
  settings: { swingLeft: 2, swingRight: 2, equalTolerancePct: 0.001, breakMethod: 'close', fvg: { enabled: true, minimumGapPct: 0, fillMethod: 'wick' }, orderBlock: { enabled: true, lookback: 5, minimumDisplacementBodyRatio: 0.6, zone: 'full-candle', mitigation: 'touch', invalidation: 'close' }, multiTimeframe: { requireDailyFourHourAlignment: true, requireLowerTimeframeAlignment: true, requireSweep: true, requireStructureBreak: true, requireZoneRetest: true, maximumCandidateBars: 30 }, minimumConfluence: 3 },
};
export function validateStrategySettings(value: unknown): { ok: true; settings: StrategySettings } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Settings must be an object.' };
  const x = value as StrategySettings;
  if (![x.swingLeft, x.swingRight].every((n) => Number.isInteger(n) && n >= 1 && n <= 10)) return { ok: false, error: 'Swing sensitivity must be an integer from 1 to 10.' };
  if (!(typeof x.equalTolerancePct === 'number' && x.equalTolerancePct >= 0 && x.equalTolerancePct <= 0.02)) return { ok: false, error: 'Equal high/low tolerance must be between 0 and 2%.' };
  if (!['close', 'wick'].includes(x.breakMethod)) return { ok: false, error: 'Break confirmation must use close or wick.' };
  if (!x.fvg || typeof x.fvg.enabled !== 'boolean' || !Number.isFinite(x.fvg.minimumGapPct) || x.fvg.minimumGapPct < 0 || x.fvg.minimumGapPct > 0.1 || !['wick', 'close'].includes(x.fvg.fillMethod)) return { ok: false, error: 'FVG settings are invalid.' };
  const ob = x.orderBlock;
  if (!ob || typeof ob.enabled !== 'boolean' || !Number.isInteger(ob.lookback) || ob.lookback < 1 || ob.lookback > 50 || !Number.isFinite(ob.minimumDisplacementBodyRatio) || ob.minimumDisplacementBodyRatio < 0 || ob.minimumDisplacementBodyRatio > 1 || !['full-candle', 'body'].includes(ob.zone) || !['touch', 'midpoint', 'close-through'].includes(ob.mitigation) || !['close', 'wick'].includes(ob.invalidation)) return { ok: false, error: 'Order-block settings are invalid.' };
  const mtf = x.multiTimeframe;
  if (!mtf || ![mtf.requireDailyFourHourAlignment, mtf.requireLowerTimeframeAlignment, mtf.requireSweep, mtf.requireStructureBreak, mtf.requireZoneRetest].every((v) => typeof v === 'boolean') || !Number.isInteger(mtf.maximumCandidateBars) || mtf.maximumCandidateBars < 1 || mtf.maximumCandidateBars > 500) return { ok: false, error: 'Multi-timeframe requirements are invalid.' };
  if (!Number.isInteger(x.minimumConfluence) || x.minimumConfluence < 0 || x.minimumConfluence > 5) return { ok: false, error: 'Minimum confluence must be from 0 to 5.' };
  return { ok: true, settings: structuredClone(x) };
}
export function settingsToEngineOptions(s: StrategySettings): EngineOptions {
  return { swingLeft: s.swingLeft, swingRight: s.swingRight, equalTolerancePct: s.equalTolerancePct, breakMethod: s.breakMethod, displacementBodyRatio: s.orderBlock.minimumDisplacementBodyRatio, orderBlockLookback: s.orderBlock.lookback, strategy: s };
}
export function describeStrategySettings(s: StrategySettings): string[] {
  return [`Swing points use ${s.swingLeft} bars left and ${s.swingRight} bars right; confirmation is delayed ${s.swingRight} bars.`, `Equal highs/lows tolerate ${(s.equalTolerancePct * 100).toFixed(3)}% price difference.`, `BOS/CHoCH uses candle ${s.breakMethod}.`, s.fvg.enabled ? `FVGs require a three-candle gap of at least ${(s.fvg.minimumGapPct * 100).toFixed(3)}%; ${s.fvg.fillMethod} fills are tracked.` : 'FVG detection is disabled.', s.orderBlock.enabled ? `Order blocks require a confirmed close-based break, a ${Math.round(s.orderBlock.minimumDisplacementBodyRatio * 100)}% body/range displacement, and an opposing candle within ${s.orderBlock.lookback} bars; zones use ${s.orderBlock.zone}, mitigation uses ${s.orderBlock.mitigation}, invalidation uses ${s.orderBlock.invalidation}.` : 'Order-block detection is disabled.', `Multi-timeframe candidate lifetime is ${s.multiTimeframe.maximumCandidateBars} bars; minimum confluence is ${s.minimumConfluence}.`];
}
