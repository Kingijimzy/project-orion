/**
 * Deterministic historical replay for the SMC rule set.
 *
 * This module contains no network, AI, database, UI, or mutable global state. It replays the
 * existing pure engine over closed candles, records the rule state at each evaluation point,
 * and — for Qualified states only — measures what price actually did next against the engine's
 * own invalidation swing. Its output is an empirical base rate from a finite sample, not a
 * forecast, and it must never be presented as a profitability estimate.
 */
import { analyzeMultiTimeframe, type EngineOptions, type OHLCV, type SetupState, type Trend } from './engine';

export type BacktestCandles = { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] };
export type BacktestInput = {
  symbol: string;
  timeframe: '30' | '60';
  candles: BacktestCandles;
  options?: EngineOptions;
  /** Target distance as a multiple of the entry-to-invalidation risk. */
  riskReward?: number;
  /** Maximum lower-timeframe candles to wait for target or stop after entry. */
  forwardBars?: number;
  /** Evaluate every Nth closed lower-timeframe candle. */
  stride?: number;
  /** Minimum number of closed lower-timeframe candles before the first evaluation. */
  warmup?: number;
  /** Hard cap on evaluation points, keeping replay bounded. */
  maxEvaluations?: number;
};

export type TradeSide = 'long' | 'short';
export type TradeOutcome = 'target' | 'stop' | 'expired' | 'open';
export type BacktestSignal = {
  timestamp: number;
  state: SetupState;
  bias: Trend;
  direction: TradeSide | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskPerUnit: number | null;
  outcome: TradeOutcome | null;
  rMultiple: number | null;
  barsHeld: number | null;
};
export type BacktestTotals = {
  signals: number;
  actionable: number;
  target: number;
  stop: number;
  expired: number;
  open: number;
  resolved: number;
  winRate: number | null;
  averageR: number | null;
  expectancyR: number | null;
};
export type BacktestReport = {
  symbol: string;
  timeframe: '30' | '60';
  source: 'deterministic-replay';
  engineInput: { riskReward: number; forwardBars: number; stride: number; warmup: number; maxEvaluations: number };
  evaluationPoints: number;
  firstEvaluationTimestamp: number | null;
  lastEvaluationTimestamp: number | null;
  byState: Record<SetupState, number>;
  trades: BacktestSignal[];
  totals: BacktestTotals;
  caveats: string[];
};

const STATES: SetupState[] = ['Watch', 'Setup Forming', 'Qualified', 'Invalidated', 'Expired'];
const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

/**
 * Resolve one trade against subsequent closed candles. When a single candle contains both the
 * target and the stop, the stop is assumed to hit first (the pessimistic, non-lookahead choice).
 */
export function resolveTradeOutcome(side: TradeSide, entry: number, stop: number, target: number, forward: OHLCV[], maxBars: number): { outcome: TradeOutcome; rMultiple: number | null; barsHeld: number } {
  const risk = Math.abs(entry - stop);
  const rr = risk > 0 ? Math.abs(target - entry) / risk : 0;
  let processed = 0;
  for (const candle of forward) {
    if (candle.closed === false) continue;
    if (processed >= maxBars) return { outcome: 'expired', rMultiple: 0, barsHeld: processed };
    processed += 1;
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit) return { outcome: 'stop', rMultiple: -1, barsHeld: processed };
    if (targetHit) return { outcome: 'target', rMultiple: rr, barsHeld: processed };
  }
  return processed >= maxBars ? { outcome: 'expired', rMultiple: 0, barsHeld: processed } : { outcome: 'open', rMultiple: null, barsHeld: processed };
}

export function runBacktest(input: BacktestInput): BacktestReport {
  const timeframe = input.timeframe;
  const riskReward = clampInt(input.riskReward ?? 2, 2, 1, 20);
  const forwardBars = clampInt(input.forwardBars ?? 60, 60, 1, 500);
  const stride = clampInt(input.stride ?? 2, 2, 1, 50);
  const warmup = clampInt(input.warmup ?? 40, 40, 0, 5000);
  const maxEvaluations = clampInt(input.maxEvaluations ?? 200, 200, 1, 1000);
  const lower = (timeframe === '30' ? input.candles.thirtyMinute : input.candles.oneHour).filter((candle) => candle.closed !== false);
  const lowerSorted = [...lower].sort((a, b) => a.timestamp - b.timestamp);
  // Spread the fixed evaluation budget across the whole series so results are not limited to the oldest slice.
  const effectiveStride = Math.max(stride, Math.ceil(Math.max(0, lowerSorted.length - warmup) / maxEvaluations));

  const byState = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<SetupState, number>;
  const trades: BacktestSignal[] = [];
  let evaluationPoints = 0;
  let firstEvaluationTimestamp: number | null = null;
  let lastEvaluationTimestamp: number | null = null;
  const aggregateIssues = new Set<string>();

  for (let index = warmup; index < lowerSorted.length && evaluationPoints < maxEvaluations; index += effectiveStride) {
    const asOfTimestamp = lowerSorted[index].timestamp;
    const analysis = analyzeMultiTimeframe({ symbol: input.symbol, timeframe, candles: input.candles, options: { ...input.options, asOfTimestamp, includeForming: false } });
    evaluationPoints += 1;
    firstEvaluationTimestamp ??= asOfTimestamp;
    lastEvaluationTimestamp = asOfTimestamp;
    byState[analysis.state] += 1;
    analysis.dataQuality.issues.forEach((issue) => aggregateIssues.add(issue));
    if (analysis.state !== 'Qualified') continue;

    const direction: TradeSide | null = analysis.higherTimeframeBias === 'bullish' ? 'long' : analysis.higherTimeframeBias === 'bearish' ? 'short' : null;
    const entryCandle = lowerSorted[index];
    const stopSwing = analysis.structure.swings.filter((swing) => swing.confirmed && swing.kind === (direction === 'long' ? 'low' : 'high')).at(-1);
    const entry = entryCandle?.close ?? null;
    const stop = stopSwing?.price ?? null;
    if (direction === null || entry === null || stop === null || !(Math.abs(entry - stop) > 0)) {
      trades.push({ timestamp: asOfTimestamp, state: analysis.state, bias: analysis.higherTimeframeBias, direction, entry, stop, target: null, riskPerUnit: null, outcome: null, rMultiple: null, barsHeld: null });
      continue;
    }
    const risk = Math.abs(entry - stop);
    const target = direction === 'long' ? entry + riskReward * risk : entry - riskReward * risk;
    const forward = lowerSorted.filter((candle) => candle.timestamp > asOfTimestamp);
    const resolved = resolveTradeOutcome(direction, entry, stop, target, forward, forwardBars);
    trades.push({ timestamp: asOfTimestamp, state: analysis.state, bias: analysis.higherTimeframeBias, direction, entry, stop, target, riskPerUnit: risk, outcome: resolved.outcome, rMultiple: resolved.rMultiple, barsHeld: resolved.barsHeld });
  }

  const actionableTrades = trades.filter((trade) => trade.outcome !== null);
  const target = actionableTrades.filter((trade) => trade.outcome === 'target').length;
  const stop = actionableTrades.filter((trade) => trade.outcome === 'stop').length;
  const expired = actionableTrades.filter((trade) => trade.outcome === 'expired').length;
  const open = actionableTrades.filter((trade) => trade.outcome === 'open').length;
  const decisive = target + stop;
  const resolvedR = actionableTrades.map((trade) => trade.rMultiple ?? 0);
  const winRate = decisive > 0 ? target / decisive : null;
  const averageR = resolvedR.length > 0 ? resolvedR.reduce((sum, value) => sum + value, 0) / resolvedR.length : null;
  const expectancyR = decisive > 0 ? (target * riskReward - stop) / decisive : null;

  const caveats = [
    'Base rates come from a bounded historical replay of this exact rule set, not a forecast or a promise of future results.',
    'When a single candle contains both the target and the stop, the stop is counted first, so results are deliberately pessimistic.',
    'Intrabar sequencing, spread, fees, funding, slippage, and liquidity are not modelled; entries use candle closes only.',
    'A small or one-sided sample is not evidence of an edge. Treat a win rate near 50% and few trades as inconclusive.',
  ];
  if (evaluationPoints === 0) caveats.push('No candles were available after warmup, so no base rate could be computed.');
  if (decisive > 0 && decisive < 20) caveats.push(`Only ${decisive} decisive trade(s) resolved; that sample is too small to interpret.`);
  for (const issue of aggregateIssues) caveats.push(`Data-quality note observed during replay: ${issue}`);

  return {
    symbol: input.symbol, timeframe, source: 'deterministic-replay',
    engineInput: { riskReward, forwardBars, stride: effectiveStride, warmup, maxEvaluations },
    evaluationPoints, firstEvaluationTimestamp, lastEvaluationTimestamp, byState, trades,
    totals: { signals: trades.length, actionable: actionableTrades.length, target, stop, expired, open, resolved: decisive, winRate, averageR, expectancyR },
    caveats,
  };
}
