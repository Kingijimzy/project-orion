/**
 * Deterministic scenario derivation from an SMC assessment.
 *
 * This module contains no network, AI, database, UI, or mutable global state. Every price it
 * emits comes from the engine's own computed swings, liquidity pools, fair-value gaps, and order
 * blocks. It never invents a level, and it never attaches a fabricated probability to a scenario;
 * an optional historical base rate is passed through only as labelled sample context.
 */
import type { FairValueGap, LiquidityPool, OrderBlock, SMCAssessment, Trend } from './engine';

export type ScenarioTarget = { label: string; price: number; source: string };
export type ScenarioKind = 'primary' | 'alternative' | 'neutral';
export type Scenario = {
  kind: ScenarioKind;
  direction: Trend;
  title: string;
  thesis: string;
  entryZones: ScenarioTarget[];
  triggers: string[];
  targets: ScenarioTarget[];
  invalidation: string[];
  evidence: string[];
};
export type HistoricalContext = { resolved: number; winRate: number | null; averageR: number | null; riskReward: number | null };
export type ScenarioInput = { analysis: SMCAssessment; lastPrice: number | null; historicalContext?: HistoricalContext | null };
export type ScenarioReport = {
  symbol: string;
  timeframe: string;
  state: string;
  bias: Trend;
  lastPrice: number | null;
  scenarios: Scenario[];
  historicalContext: HistoricalContext | null;
  notes: string[];
};

const isFiniteLevel = (value: number): boolean => Number.isFinite(value) && value > 0;

export function buildScenarios(input: ScenarioInput): ScenarioReport {
  const { analysis } = input;
  const lastPrice = input.lastPrice !== null && isFiniteLevel(input.lastPrice) ? input.lastPrice : null;
  const bias = analysis.higherTimeframeBias;
  const opposite: Trend = bias === 'bullish' ? 'bearish' : bias === 'bearish' ? 'bullish' : 'neutral';
  const notes: string[] = [];
  if (lastPrice === null) notes.push('No current price was provided, so entry zones and liquidity targets cannot be ranked against price.');
  if (analysis.dataQuality.stale || !analysis.dataQuality.valid) notes.push('Data quality limits this assessment; treat every scenario as provisional.');

  const gapZones = (direction: Trend): ScenarioTarget[] => analysis.fvgs
    .filter((gap): gap is FairValueGap => gap.direction === direction && gap.confirmed && gap.status !== 'filled' && gap.status !== 'invalidated')
    .map((gap) => ({ label: `FVG ${gap.lower.toFixed(6)}–${gap.upper.toFixed(6)}`, price: (gap.lower + gap.upper) / 2, source: 'Fair-value gap (engine)' }));
  const blockZones = (direction: Trend): ScenarioTarget[] => analysis.orderBlocks
    .filter((block): block is OrderBlock => block.direction === direction && block.confirmed && block.status === 'unmitigated')
    .map((block) => ({ label: `Order block ${block.lower.toFixed(6)}–${block.upper.toFixed(6)}`, price: (block.lower + block.upper) / 2, source: 'Unmitigated order block (engine)' }));
  const zonesFor = (direction: Trend, side: 'below' | 'above'): ScenarioTarget[] => {
    const zones = [...gapZones(direction), ...blockZones(direction)];
    if (lastPrice === null) return zones.slice(-4);
    return zones
      .filter((zone) => side === 'below' ? zone.price <= lastPrice * 1.001 : zone.price >= lastPrice * 0.999)
      .sort((a, b) => side === 'below' ? b.price - a.price : a.price - b.price)
      .slice(0, 4);
  };
  const liquidityTargets = (direction: Trend): ScenarioTarget[] => {
    const kind: LiquidityPool['kind'] = direction === 'bullish' ? 'high' : 'low';
    const pools = analysis.relevantLiquidity
      .filter((pool) => pool.kind === kind && isFiniteLevel(pool.level))
      .filter((pool) => lastPrice === null || (direction === 'bullish' ? pool.level > lastPrice : pool.level < lastPrice))
      .sort((a, b) => direction === 'bullish' ? a.level - b.level : b.level - a.level)
      .slice(0, 3)
      .map((pool) => ({ label: `${pool.kind === 'high' ? 'Buy-side' : 'Sell-side'} liquidity ${pool.level.toFixed(6)}`, price: pool.level, source: 'Equal-high/low liquidity pool (engine)' }));
    if (pools.length) return pools;
    const swings = analysis.structure.swings.filter((swing) => swing.confirmed && swing.kind === (direction === 'bullish' ? 'high' : 'low') && (lastPrice === null || (direction === 'bullish' ? swing.price > lastPrice : swing.price < lastPrice)));
    return swings.sort((a, b) => direction === 'bullish' ? a.price - b.price : b.price - a.price).slice(0, 3).map((swing) => ({ label: `Confirmed swing ${swing.kind} ${swing.price.toFixed(6)}`, price: swing.price, source: 'Confirmed swing (engine)' }));
  };

  const scenarios: Scenario[] = [];
  if (bias !== 'neutral') {
    const entrySide = bias === 'bullish' ? 'below' : 'above';
    const entryZones = zonesFor(bias, entrySide);
    const targets = liquidityTargets(bias);
    scenarios.push({
      kind: 'primary', direction: bias,
      title: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} continuation (bias-aligned)`,
      thesis: `Daily/4H context is ${analysis.dailyBias}/${analysis.fourHourBias} and the ${analysis.timeframe === '30' ? '30M' : '1H'} structure is ${analysis.structure.structure}. This scenario assumes that ${bias} higher-timeframe bias holds.`,
      entryZones,
      triggers: analysis.requiredConfirmation.length ? analysis.requiredConfirmation : ['The deterministic rule set currently reports no outstanding confirmation requirement; re-check after the next closed candle.'],
      targets,
      invalidation: analysis.invalidationConditions,
      evidence: analysis.supportingEvidence.length ? analysis.supportingEvidence : ['No supporting rule evidence was recorded.'],
    });
  }

  const showAlternative = bias === 'neutral' || analysis.conflictingEvidence.length > 0 || analysis.state === 'Invalidated';
  if (showAlternative && opposite !== 'neutral') {
    scenarios.push({
      kind: 'alternative', direction: opposite,
      title: `${opposite === 'bullish' ? 'Bullish' : 'Bearish'} reversal (counter-bias)`,
      thesis: `Only valid if the ${bias} thesis fails. A confirmed opposite-direction change of character would flip the structural bias toward ${opposite}.`,
      entryZones: zonesFor(opposite, opposite === 'bullish' ? 'below' : 'above'),
      triggers: [`Wait for a confirmed opposite-direction CHoCH that closes beyond the latest opposing swing.`, ...(analysis.conflictingEvidence.length ? analysis.conflictingEvidence : [])],
      targets: liquidityTargets(opposite),
      invalidation: [`A confirmed ${bias} continuation back beyond the reversal trigger invalidates this alternative.`],
      evidence: analysis.conflictingEvidence.length ? analysis.conflictingEvidence : ['Recorded as a contingency because the current bias is not aligned.'],
    });
  }

  if (bias === 'neutral' || analysis.state === 'Watch') {
    scenarios.push({
      kind: 'neutral', direction: 'neutral',
      title: 'Wait / no directional setup',
      thesis: 'Higher-timeframe structure is not aligned, so no directional scenario is justified yet. Stay flat until the rule set produces a bias.',
      entryZones: [],
      triggers: analysis.requiredConfirmation.length ? analysis.requiredConfirmation : ['Wait for Daily and 4H structure to align before defining an entry.'],
      targets: [],
      invalidation: analysis.invalidationConditions,
      evidence: analysis.conflictingEvidence.length ? analysis.conflictingEvidence : ['No directional rule evidence is available.'],
    });
  }

  return {
    symbol: analysis.symbol,
    timeframe: analysis.timeframe,
    state: analysis.state,
    bias,
    lastPrice,
    scenarios,
    historicalContext: input.historicalContext ?? null,
    notes: [...notes, 'Scenarios are conditional rule descriptions, not probabilities. No per-scenario confidence score is generated.'],
  };
}
