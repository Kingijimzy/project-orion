/**
 * Deterministic SMC calculations. No network, AI, database, UI, or mutable global state.
 * Defaults are intentionally conservative and documented in README.md.
 */
export type OHLCV = { timestamp: number; open: number; high: number; low: number; close: number; volume: number; closed?: boolean };
export type BreakMethod = 'close' | 'wick';
export type Trend = 'bullish' | 'bearish' | 'neutral';
export type StructureLabel = 'HH' | 'HL' | 'LH' | 'LL';
export type EngineOptions = {
  swingLeft?: number;
  swingRight?: number;
  equalTolerancePct?: number;
  breakMethod?: BreakMethod;
  displacementBodyRatio?: number;
  orderBlockLookback?: number;
  maxDataAgeMs?: number;
  maxGapPeriods?: number;
  now?: number;
  /** Historical replay cutoff. Candles after this time are removed before every calculation. */
  asOfTimestamp?: number;
  includeForming?: boolean;
  strategy?: import('./strategy-profile').StrategySettings;
};
export type DataQuality = { valid: boolean; stale: boolean; missingCandles: number; excludedFormingCandles: number; issues: string[]; lastCandleTimestamp: number | null; lastCandleClosed: boolean | null };
export type Swing = { kind: 'high' | 'low'; index: number; timestamp: number; price: number; confirmedAt: number; confirmedIndex: number; confirmed: boolean; label?: StructureLabel };
export type StructureBreak = { kind: 'BOS' | 'CHoCH'; direction: 'bullish' | 'bearish'; symbol: string; timeframe: string; timestamp: number; price: number; swingIndex: number; swingTimestamp: number; candleIndex: number; confirmationMethod: BreakMethod; confirmed: boolean };
export type LiquidityPool = { kind: 'high' | 'low'; level: number; touches: number; swingTimestamps: number[]; createdAt: number; equal: boolean };
export type LiquiditySweep = { kind: 'high' | 'low'; level: number; timestamp: number; candleIndex: number; breached: boolean; rejectionObserved: boolean; confirmed: boolean; reversalConfirmedAt: number | null; explanation: string };
export type FairValueGap = { direction: 'bullish' | 'bearish'; lower: number; upper: number; firstCandleTimestamp: number; middleCandleTimestamp: number; creationTimestamp: number; creationIndex: number; status: 'untouched' | 'partially-filled' | 'filled' | 'invalidated'; fillTimestamp: number | null; confirmed: boolean; explanation: string };
export type OrderBlock = { direction: 'bullish' | 'bearish'; lower: number; upper: number; sourceCandleTimestamp: number; swingTimestamp: number; swingIndex: number; creationTimestamp: number; creationIndex: number; status: 'unmitigated' | 'mitigated' | 'invalidated'; mitigationTimestamp: number | null; invalidation: string; displacementRatio: number; confirmed: boolean; explanation: string };
export type TimeframeAnalysis = { symbol: string; timeframe: string; analysisTimestamp: number; lastCandleTimestamp: number | null; lastCandleClosed: boolean | null; dataQuality: DataQuality; swings: Swing[]; structure: Trend; structureBreaks: StructureBreak[]; liquidityPools: LiquidityPool[]; sweeps: LiquiditySweep[]; fvgs: FairValueGap[]; orderBlocks: OrderBlock[] };
export type SetupState = 'Watch' | 'Setup Forming' | 'Qualified' | 'Invalidated' | 'Expired';
export type SMCAssessment = {
  symbol: string; analysisTimestamp: number; timeframe: '30' | '60'; state: SetupState;
  higherTimeframeBias: Trend; dailyBias: Trend; fourHourBias: Trend; lowerTimeframeStructure: Trend;
  structure: TimeframeAnalysis; higherTimeframes: { daily: TimeframeAnalysis; fourHour: TimeframeAnalysis };
  alignedCandles: { timeframe: string; lowerTimestamp: number; higherCandleTimestamp: number | null; higherCandleClosed: boolean }[];
  relevantLiquidity: LiquidityPool[]; fvgs: FairValueGap[]; orderBlocks: OrderBlock[];
  supportingEvidence: string[]; conflictingEvidence: string[]; requiredConfirmation: string[]; invalidationConditions: string[];
  dataQuality: { valid: boolean; stale: boolean; issues: string[] };
  qualificationRule: string;
};

const MS_MINUTE = 60_000;
export function timeframeDurationMs(timeframe: string, timestamp = Date.UTC(2026, 0, 1)): number {
  if (timeframe === 'D' || timeframe === '1D') return 86_400_000;
  if (timeframe === 'W' || timeframe === '1W') return 7 * 86_400_000;
  if (timeframe === 'M' || timeframe === '1M') { const date = new Date(timestamp); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); }
  const minutes = Number(timeframe.endsWith('m') ? timeframe.slice(0, -1) : timeframe);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return minutes * MS_MINUTE;
}
function nextTimestamp(timestamp: number, timeframe: string): number {
  if (timeframe === 'M' || timeframe === '1M') { const d = new Date(timestamp); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return timestamp + timeframeDurationMs(timeframe, timestamp);
}
function isTimeframeBoundary(timestamp: number, timeframe: string): boolean {
  const date = new Date(timestamp);
  if (timeframe === 'D' || timeframe === '1D') return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (timeframe === 'W' || timeframe === '1W') return date.getUTCDay() === 1 && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (timeframe === 'M' || timeframe === '1M') return date.getUTCDate() === 1 && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return timestamp % timeframeDurationMs(timeframe, timestamp) === 0;
}
function isClosed(candle: OHLCV): boolean { return candle.closed !== false; }

export function validateCandles(input: OHLCV[], timeframe: string, options: EngineOptions = {}): { candles: OHLCV[]; quality: DataQuality } {
  const issues: string[] = [];
  let valid = true;
  let missingCandles = 0;
  const now = options.now ?? Date.now();
  const originalLast = input.at(-1) ?? null;
  if (!Array.isArray(input) || input.length === 0) issues.push('No candles were supplied.'), valid = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (!c || !Number.isSafeInteger(c.timestamp) || c.timestamp <= 0 || ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 || c.volume < 0 || c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close,c.high)) {
      issues.push(`Malformed OHLCV candle at index ${i}.`); valid = false; continue;
    }
    if (!isTimeframeBoundary(c.timestamp, timeframe)) { issues.push(`Candle timestamp at index ${i} is not aligned to ${timeframe}.`); valid = false; }
    if (c.timestamp > now + 60_000) { issues.push(`Candle at index ${i} is future-dated.`); valid = false; }
    if (i > 0) {
      const previousTimestamp = input[i - 1]?.timestamp;
      if (!Number.isSafeInteger(previousTimestamp)) continue;
      if (c.timestamp === previousTimestamp) { issues.push(`Duplicate candle timestamp at index ${i}.`); valid = false; }
      else if (c.timestamp < previousTimestamp) { issues.push(`Candles are not ordered oldest to newest at index ${i}.`); valid = false; }
      else {
        const expected = nextTimestamp(previousTimestamp, timeframe);
        if (c.timestamp > expected + timeframeDurationMs(timeframe, c.timestamp) * 0.25) missingCandles += Math.max(1, Math.round((c.timestamp - expected) / timeframeDurationMs(timeframe, c.timestamp)));
      }
    }
  }
  if (missingCandles) {
    issues.push(`${missingCandles} expected candle(s) are missing.`);
    if (missingCandles > (options.maxGapPeriods ?? 0)) valid = false;
  }
  const excludedFormingCandles = options.includeForming ? 0 : input.filter((c) => c?.closed === false).length;
  const candles = input.filter((c) => options.includeForming || isClosed(c));
  const latest = candles.at(-1) ?? null;
  const defaultAge = timeframeDurationMs(timeframe, latest?.timestamp ?? now) * 2.5;
  const stale = latest ? now - latest.timestamp > (options.maxDataAgeMs ?? defaultAge) : true;
  if (stale) issues.push('Latest candle is older than the configured freshness limit.');
  if (excludedFormingCandles) issues.push(`${excludedFormingCandles} forming candle(s) excluded from confirmed analysis.`);
  if (options.includeForming && candles.some((c) => c.closed === false)) issues.push('Forming candle included; any finding that uses it is provisional.');
  return { candles, quality: { valid, stale, missingCandles, excludedFormingCandles, issues, lastCandleTimestamp: latest?.timestamp ?? originalLast?.timestamp ?? null, lastCandleClosed: latest ? isClosed(latest) : originalLast ? isClosed(originalLast) : null } };
}

function detectSwings(candles: OHLCV[], left: number, right: number): Swing[] {
  const result: Swing[] = [];
  for (let i = left; i < candles.length - left; i += 1) {
    const highLeft = i - left;
    const rightEnd = Math.min(candles.length - 1, i + right);
    const complete = i + right < candles.length;
    const high = candles[i].high > Math.max(...candles.slice(highLeft, i).map((c) => c.high)) && candles[i].high > Math.max(...candles.slice(i + 1, rightEnd + 1).map((c) => c.high));
    const low = candles[i].low < Math.min(...candles.slice(highLeft, i).map((c) => c.low)) && candles[i].low < Math.min(...candles.slice(i + 1, rightEnd + 1).map((c) => c.low));
    if (high) result.push({ kind: 'high', index: i, timestamp: candles[i].timestamp, price: candles[i].high, confirmedAt: candles[rightEnd].timestamp, confirmedIndex: rightEnd, confirmed: complete && candles.slice(i + 1, rightEnd + 1).every(isClosed) });
    if (low) result.push({ kind: 'low', index: i, timestamp: candles[i].timestamp, price: candles[i].low, confirmedAt: candles[rightEnd].timestamp, confirmedIndex: rightEnd, confirmed: complete && candles.slice(i + 1, rightEnd + 1).every(isClosed) });
  }
  return result.sort((a,b)=>a.index-b.index || (a.kind === 'high' ? -1 : 1));
}
function classifySwings(swings: Swing[]): Swing[] {
  const previous: { high?: Swing; low?: Swing } = {};
  return swings.map((swing) => {
    const prior = previous[swing.kind];
    const label: StructureLabel | undefined = prior ? swing.kind === 'high' ? (swing.price > prior.price ? 'HH' : 'LH') : (swing.price > prior.price ? 'HL' : 'LL') : undefined;
    const classified = { ...swing, label };
    previous[swing.kind] = classified;
    return classified;
  });
}
function trendAt(swings: Swing[], candleIndex: number): Trend {
  const confirmed = swings.filter((s) => s.confirmed && s.confirmedIndex < candleIndex && s.label);
  const high = confirmed.filter((s) => s.kind === 'high').at(-1)?.label;
  const low = confirmed.filter((s) => s.kind === 'low').at(-1)?.label;
  if (high === 'HH' && low === 'HL') return 'bullish';
  if (high === 'LH' && low === 'LL') return 'bearish';
  return 'neutral';
}
function crossed(candle: OHLCV, swing: Swing, direction: 'bullish'|'bearish', method: BreakMethod): boolean {
  return method === 'close' ? direction === 'bullish' ? candle.close > swing.price : candle.close < swing.price : direction === 'bullish' ? candle.high > swing.price : candle.low < swing.price;
}
function wasBeyond(candle: OHLCV, price: number, direction: 'bullish'|'bearish', method: BreakMethod): boolean {
  return method === 'close' ? direction === 'bullish' ? candle.close > price : candle.close < price : direction === 'bullish' ? candle.high > price : candle.low < price;
}

function detectBreaks(candles: OHLCV[], swings: Swing[], symbol: string, timeframe: string, method: BreakMethod): StructureBreak[] {
  const events: StructureBreak[] = [];
  const broken = new Set<string>();
  for (let i = 0; i < candles.length; i += 1) {
    for (const swing of swings) {
      if (!swing.confirmed || swing.confirmedIndex >= i || broken.has(`${swing.kind}:${swing.index}`)) continue;
      const direction = swing.kind === 'high' ? 'bullish' : 'bearish';
      if (!crossed(candles[i], swing, direction, method) || (i > 0 && wasBeyond(candles[i - 1], swing.price, direction, method))) continue;
      const priorTrend = trendAt(swings, i);
      const kind = priorTrend !== 'neutral' && priorTrend !== direction ? 'CHoCH' : 'BOS';
      const confirmed = isClosed(candles[i]);
      events.push({ kind, direction, symbol, timeframe, timestamp: candles[i].timestamp, price: swing.price, swingIndex: swing.index, swingTimestamp: swing.timestamp, candleIndex: i, confirmationMethod: method, confirmed });
      broken.add(`${swing.kind}:${swing.index}`);
    }
  }
  return events.sort((a,b)=>a.candleIndex-b.candleIndex);
}
function detectLiquidity(swings: Swing[], candles: OHLCV[], tolerancePct: number, breaks: StructureBreak[]): { pools: LiquidityPool[]; sweeps: LiquiditySweep[] } {
  const pools: LiquidityPool[] = [];
  for (const kind of ['high','low'] as const) {
    const points = swings.filter((s) => s.kind === kind && s.confirmed);
    const clusters: Swing[][] = [];
    for (const point of points) {
      let cluster = clusters.find((group) => Math.abs(point.price - group[0].price) / group[0].price <= tolerancePct);
      if (!cluster) { cluster = []; clusters.push(cluster); }
      cluster.push(point);
    }
    for (const cluster of clusters) {
      const level = cluster.reduce((sum,p)=>sum+p.price,0)/cluster.length;
      pools.push({ kind, level, touches: cluster.length, swingTimestamps: cluster.map((s)=>s.timestamp), createdAt: cluster.at(-1)!.confirmedAt, equal: cluster.length >= 2 });
    }
  }
  const sweeps: LiquiditySweep[] = [];
  for (const pool of pools) {
    for (let i = 0; i < candles.length; i += 1) {
      if (candles[i].timestamp <= pool.createdAt) continue;
      const threshold = pool.kind === 'high' ? pool.level * (1 + tolerancePct * 0.1) : pool.level * (1 - tolerancePct * 0.1);
      const breached = pool.kind === 'high' ? candles[i].high > threshold : candles[i].low < threshold;
      const previouslyBreached = i > 0 && (pool.kind === 'high' ? candles[i - 1].high > threshold : candles[i - 1].low < threshold);
      if (!breached || previouslyBreached) continue;
      const rejectionObserved = pool.kind === 'high' ? candles[i].close < pool.level : candles[i].close > pool.level;
      const reversal = breaks.find((b) => b.candleIndex > i && b.confirmed && b.kind === 'CHoCH' && b.direction === (pool.kind === 'low' ? 'bullish' : 'bearish'));
      sweeps.push({ kind: pool.kind, level: pool.level, timestamp: candles[i].timestamp, candleIndex: i, breached: true, rejectionObserved, confirmed: isClosed(candles[i]), reversalConfirmedAt: reversal?.timestamp ?? null, explanation: `Price breached a ${pool.kind} liquidity reference. ${rejectionObserved ? 'The candle closed back across the level (rejection observed).' : 'No close-back rejection was observed.'} This is a price observation and does not establish institutional intent.` });
    }
  }
  return { pools: pools.sort((a,b)=>a.createdAt-b.createdAt), sweeps: sweeps.sort((a,b)=>a.candleIndex-b.candleIndex) };
}
function detectFvgs(candles: OHLCV[], strategy?: EngineOptions['strategy']): FairValueGap[] {
  if (strategy?.fvg.enabled === false) return [];
  const gaps: FairValueGap[] = [];
  for (let i = 0; i + 2 < candles.length; i += 1) {
    const first = candles[i], third = candles[i + 2];
    let direction: FairValueGap['direction'] | null = null, lower = 0, upper = 0;
    if (third.low > first.high) { direction = 'bullish'; lower = first.high; upper = third.low; }
    else if (third.high < first.low) { direction = 'bearish'; lower = third.high; upper = first.low; }
    if (!direction) continue;
    if ((upper - lower) / Math.max(first.close, third.close) < (strategy?.fvg.minimumGapPct ?? 0)) continue;
    let status: FairValueGap['status'] = 'untouched';
    let fillTimestamp: number | null = null;
    for (let j = i + 3; j < candles.length; j += 1) {
      const c = candles[j];
      const invalid = direction === 'bullish' ? c.close < lower : c.close > upper;
      const full = direction === 'bullish' ? (strategy?.fvg.fillMethod === 'close' ? c.close <= lower : c.low <= lower) : (strategy?.fvg.fillMethod === 'close' ? c.close >= upper : c.high >= upper);
      const touched = strategy?.fvg.fillMethod === 'close'
        ? direction === 'bullish' ? c.close <= upper : c.close >= lower
        : direction === 'bullish' ? c.low <= upper : c.high >= lower;
      if (invalid) { status = 'invalidated'; fillTimestamp = c.timestamp; break; }
      if (full) { status = 'filled'; fillTimestamp = c.timestamp; break; }
      if (touched && status === 'untouched') { status = 'partially-filled'; fillTimestamp = c.timestamp; }
    }
    gaps.push({ direction, lower, upper, firstCandleTimestamp: first.timestamp, middleCandleTimestamp:candles[i+1].timestamp, creationTimestamp: third.timestamp, creationIndex: i + 2, status, fillTimestamp, confirmed: isClosed(third), explanation: `${direction} three-candle gap: candle 3 did not overlap candle 1 range. Fill progress is measured by later ${strategy?.fvg.fillMethod ?? 'wick'} interaction; a close through the far boundary marks invalidation.` });
  }
  return gaps;
}
function detectOrderBlocks(candles: OHLCV[], breaks: StructureBreak[], lookback: number, minBodyRatio: number, strategy?: EngineOptions['strategy']): OrderBlock[] {
  if (strategy?.orderBlock.enabled === false) return [];
  const blocks: OrderBlock[] = [];
  for (const event of breaks) {
    const direction = event.direction;
    const breakCandle = candles[event.candleIndex];
    const range = breakCandle.high - breakCandle.low;
    const bodyRatio = range > 0 ? Math.abs(breakCandle.close - breakCandle.open) / range : 0;
    if (!event.confirmed || event.confirmationMethod !== 'close' || bodyRatio < minBodyRatio) continue;
    const start = Math.max(0, event.candleIndex - lookback);
    let sourceIndex = -1;
    for (let j = event.candleIndex - 1; j >= start; j -= 1) {
      const opposing = direction === 'bullish' ? candles[j].close < candles[j].open : candles[j].close > candles[j].open;
      if (opposing) { sourceIndex = j; break; }
    }
    if (sourceIndex < 0) continue;
    const source = candles[sourceIndex];
    const lower = strategy?.orderBlock.zone === 'body' ? Math.min(source.open, source.close) : source.low;
    const upper = strategy?.orderBlock.zone === 'body' ? Math.max(source.open, source.close) : source.high;
    let status: OrderBlock['status'] = 'unmitigated'; let mitigationTimestamp: number | null = null;
    for (let j = event.candleIndex + 1; j < candles.length; j += 1) {
      const c = candles[j];
      const invalid = direction === 'bullish' ? (strategy?.orderBlock.invalidation === 'wick' ? c.low < lower : c.close < lower) : (strategy?.orderBlock.invalidation === 'wick' ? c.high > upper : c.close > upper);
      if (invalid) { status = 'invalidated'; mitigationTimestamp = c.timestamp; break; }
      const midpoint = (lower + upper) / 2;
      const overlap = strategy?.orderBlock.mitigation === 'midpoint' ? (direction === 'bullish' ? c.low <= midpoint : c.high >= midpoint) : strategy?.orderBlock.mitigation === 'close-through' ? (direction === 'bullish' ? c.close < upper : c.close > lower) : c.low <= upper && c.high >= lower;
      if (overlap) { status = 'mitigated'; mitigationTimestamp = c.timestamp; break; }
    }
    blocks.push({ direction, lower, upper, sourceCandleTimestamp: source.timestamp, swingTimestamp:event.swingTimestamp, swingIndex:event.swingIndex, creationTimestamp: event.timestamp, creationIndex: event.candleIndex, status, mitigationTimestamp, invalidation: direction === 'bullish' ? `${strategy?.orderBlock.invalidation ?? 'close'} below source zone (${lower}).` : `${strategy?.orderBlock.invalidation ?? 'close'} above source zone (${upper}).`, displacementRatio: bodyRatio, confirmed: event.confirmed, explanation: `Candidate requires a confirmed close-based structure break, break-candle body/range ≥ ${minBodyRatio}, and the nearest opposing candle within ${lookback} bars. Zone uses the source candle ${strategy?.orderBlock.zone === 'body' ? 'body' : 'full high-low range'}; mitigation is ${strategy?.orderBlock.mitigation ?? 'touch'}.` });
  }
  return blocks;
}

export function analyzeTimeframe(input: OHLCV[], symbol: string, timeframe: string, options: EngineOptions = {}): TimeframeAnalysis {
  const asOfTimestamp = options.asOfTimestamp;
  const history = asOfTimestamp === undefined ? input : input.filter((candle) => candle.timestamp <= asOfTimestamp).map((candle) => ({ ...candle, closed: isClosed(candle) && nextTimestamp(candle.timestamp, timeframe) <= asOfTimestamp }));
  const calculationOptions = asOfTimestamp === undefined || options.now !== undefined ? options : { ...options, now: asOfTimestamp };
  const validated = validateCandles(history, timeframe, calculationOptions);
  const candles = validated.candles;
  if (!validated.quality.valid || candles.length === 0) {
    return { symbol, timeframe, analysisTimestamp: options.asOfTimestamp ?? options.now ?? Date.now(), lastCandleTimestamp: validated.quality.lastCandleTimestamp, lastCandleClosed: validated.quality.lastCandleClosed, dataQuality: validated.quality, swings: [], structure: 'neutral', structureBreaks: [], liquidityPools: [], sweeps: [], fvgs: [], orderBlocks: [] };
  }
  const left = options.swingLeft ?? 2, right = options.swingRight ?? 2;
  const rawSwings = detectSwings(candles, left, right);
  const swings = classifySwings(rawSwings);
  const method = options.breakMethod ?? 'close';
  const structureBreaks = detectBreaks(candles, swings, symbol, timeframe, method);
  const liquidity = detectLiquidity(swings, candles, options.equalTolerancePct ?? 0.001, structureBreaks);
  const fvgs = detectFvgs(candles, options.strategy);
  const orderBlocks = detectOrderBlocks(candles, structureBreaks, options.strategy?.orderBlock.lookback ?? options.orderBlockLookback ?? 5, options.strategy?.orderBlock.minimumDisplacementBodyRatio ?? options.displacementBodyRatio ?? 0.6, options.strategy);
  const lastIndex = candles.length - 1;
  const structure = trendAt(swings, lastIndex + 1);
  const latest = candles.at(-1);
  return { symbol, timeframe, analysisTimestamp: options.asOfTimestamp ?? options.now ?? Date.now(), lastCandleTimestamp: latest?.timestamp ?? null, lastCandleClosed: latest ? isClosed(latest) : null, dataQuality: validated.quality, swings, structure, structureBreaks, liquidityPools: liquidity.pools, sweeps: liquidity.sweeps, fvgs, orderBlocks };
}

export function alignHigherTimeframeCandles(lowerCandles: OHLCV[], higherCandles: OHLCV[], higherTimeframe: string): { timeframe: string; lowerTimestamp: number; higherCandleTimestamp: number | null; higherCandleClosed: boolean }[] {
  return lowerCandles.map((lower) => {
    const eligible = higherCandles.filter((higher) => isClosed(higher) && nextTimestamp(higher.timestamp, higherTimeframe) <= lower.timestamp);
    const selected = eligible.at(-1) ?? null;
    return { timeframe: higherTimeframe, lowerTimestamp: lower.timestamp, higherCandleTimestamp: selected?.timestamp ?? null, higherCandleClosed: Boolean(selected) };
  });
}
function alignedTrend(high: Trend, fourHour: Trend): Trend { return high === fourHour ? high : 'neutral'; }
function zoneRetested(candle: OHLCV, zone: { lower: number; upper: number }): boolean { return candle.low <= zone.upper && candle.high >= zone.lower; }

export function analyzeMultiTimeframe(input: { symbol: string; candles: { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] }; timeframe: '30'|'60'; options?: EngineOptions }): SMCAssessment {
  const { symbol, candles, timeframe } = input; const options = input.options ?? {};
  const replayCandles = (series: OHLCV[], timeframe: string) => options.asOfTimestamp === undefined ? series : series.filter((candle) => candle.timestamp <= options.asOfTimestamp!).map((candle) => ({ ...candle, closed: isClosed(candle) && nextTimestamp(candle.timestamp, timeframe) <= options.asOfTimestamp! }));
  const dailyCandles = replayCandles(candles.daily, 'D'), fourHourCandles = replayCandles(candles.fourHour, '240');
  const oneHourCandles = replayCandles(candles.oneHour, '60'), thirtyMinuteCandles = replayCandles(candles.thirtyMinute, '30');
  const daily = analyzeTimeframe(dailyCandles, symbol, 'D', options);
  const fourHour = analyzeTimeframe(fourHourCandles, symbol, '240', options);
  const selectedCandles = timeframe === '30' ? thirtyMinuteCandles : oneHourCandles;
  const structure = analyzeTimeframe(selectedCandles, symbol, timeframe, options);
  const dailyBias = daily.structure, fourHourBias = fourHour.structure;
  const higherTimeframeBias = options.strategy?.multiTimeframe.requireDailyFourHourAlignment === false
    ? dailyBias !== 'neutral' ? dailyBias : fourHourBias
    : alignedTrend(dailyBias, fourHourBias);
  const supportingEvidence: string[] = [], conflictingEvidence: string[] = [], requiredConfirmation: string[] = [];
  const requirements=options.strategy?.multiTimeframe;
  const requireStructureBreak=requirements?.requireStructureBreak ?? true;
  const requireSweep=requirements?.requireSweep ?? true;
  const requireZoneRetest=requirements?.requireZoneRetest ?? true;
  if (dailyBias !== 'neutral' && dailyBias === fourHourBias) supportingEvidence.push(`Daily and 4H structure align ${dailyBias}.`);
  else if (options.strategy?.multiTimeframe.requireDailyFourHourAlignment !== false) conflictingEvidence.push(`Higher-timeframe structure is not aligned (Daily: ${dailyBias}; 4H: ${fourHourBias}).`);
  else supportingEvidence.push(`Daily/4H alignment is optional in this profile; directional context uses ${dailyBias !== 'neutral' ? 'Daily' : '4H'} structure (${higherTimeframeBias}).`);
  if (higherTimeframeBias !== 'neutral' && structure.structure === higherTimeframeBias) supportingEvidence.push(`${timeframe === '30' ? '30M' : '1H'} structure agrees with higher-timeframe bias.`);
  else if (higherTimeframeBias !== 'neutral') conflictingEvidence.push(`${timeframe === '30' ? '30M' : '1H'} structure is ${structure.structure}, against ${higherTimeframeBias} higher-timeframe bias.`);
  const recentSweep = structure.sweeps.filter((s) => s.confirmed && s.rejectionObserved && s.kind === (higherTimeframeBias === 'bullish' ? 'low' : 'high')).at(-1);
  const directionalBreak = structure.structureBreaks.filter((b) => b.confirmed && b.direction === higherTimeframeBias && (!recentSweep || b.timestamp > recentSweep.timestamp)).at(-1);
  const alignedZones = [...structure.fvgs.filter((g) => g.confirmed && g.status !== 'filled' && g.status !== 'invalidated' && g.direction === higherTimeframeBias), ...structure.orderBlocks.filter((b) => b.confirmed && b.status === 'unmitigated' && b.direction === higherTimeframeBias)];
  const lastCandle = (timeframe === '30' ? candles.thirtyMinute : candles.oneHour).filter((c) => options.includeForming || isClosed(c)).at(-1);
  const retest = Boolean(lastCandle && alignedZones.some((zone) => zoneRetested(lastCandle, zone)));
  const confluenceCount = [dailyBias === fourHourBias && higherTimeframeBias !== 'neutral', structure.structure === higherTimeframeBias && higherTimeframeBias !== 'neutral', Boolean(recentSweep), Boolean(directionalBreak), Boolean(alignedZones.length && retest)].filter(Boolean).length;
  if (directionalBreak) supportingEvidence.push(`Confirmed ${directionalBreak.kind} ${directionalBreak.direction} at ${directionalBreak.price} on ${new Date(directionalBreak.timestamp).toISOString()}.`);
  else if(requireStructureBreak) requiredConfirmation.push(`Wait for a confirmed ${higherTimeframeBias === 'bearish' ? 'bearish' : 'bullish'} ${options.breakMethod ?? 'close'}-based structure break.`);
  if (recentSweep) supportingEvidence.push(`${recentSweep.kind} liquidity was breached and the candle closed back across ${recentSweep.level}; this is a rejection observation, not proof of reversal or intent.`);
  else if(requireSweep) requiredConfirmation.push(`Wait for a ${higherTimeframeBias === 'bullish' ? 'low' : 'high'}-side liquidity sweep with a close-back rejection.`);
  if (alignedZones.length && retest) supportingEvidence.push('The latest closed candle revisited an unfilled, direction-aligned FVG or unmitigated order-block candidate.');
  else if(requireZoneRetest) requiredConfirmation.push('Wait for price to revisit a direction-aligned, still-valid FVG or order-block candidate.');
  const minimumConfluence = options.strategy?.minimumConfluence ?? 0;
  if (confluenceCount < minimumConfluence) requiredConfirmation.push(`Confluence is ${confluenceCount}; the selected profile requires ${minimumConfluence}.`);
  const qualities = [daily.dataQuality, fourHour.dataQuality, structure.dataQuality];
  const issues = qualities.flatMap((q) => q.issues);
  const valid = qualities.every((q) => q.valid);
  const stale = qualities.some((q) => q.stale);
  const lastOpposing = structure.structureBreaks.filter((b) => b.confirmed && b.kind === 'CHoCH' && b.direction !== higherTimeframeBias).at(-1);
  let state: SetupState = 'Watch';
  const candidateTime = [recentSweep?.timestamp, directionalBreak?.timestamp].filter((v): v is number => typeof v === 'number').sort((a,b)=>b-a)[0];
  const maxCandidateBars = options.strategy?.multiTimeframe.maximumCandidateBars ?? 30;
  const expired = candidateTime !== undefined && lastCandle !== undefined && lastCandle.timestamp - candidateTime > timeframeDurationMs(timeframe, lastCandle.timestamp) * maxCandidateBars;
  if (!valid || stale || higherTimeframeBias === 'neutral') state = 'Watch';
  else if (lastOpposing && candidateTime && lastOpposing.timestamp > candidateTime) state = 'Invalidated';
  else if (expired) state = 'Expired';
  else if ((!options.strategy?.multiTimeframe.requireStructureBreak || directionalBreak) && (!options.strategy?.multiTimeframe.requireSweep || recentSweep) && (!options.strategy?.multiTimeframe.requireZoneRetest || (alignedZones.length && retest)) && (!options.strategy?.multiTimeframe.requireLowerTimeframeAlignment || structure.structure === higherTimeframeBias) && (!options.strategy?.multiTimeframe.requireDailyFourHourAlignment || dailyBias === fourHourBias) && confluenceCount >= minimumConfluence && (lastCandle?.closed !== false)) state = 'Qualified';
  else if (directionalBreak || recentSweep) state = 'Setup Forming';
  const activeCandidate = state === 'Setup Forming' || state === 'Qualified';
  const latestSwing = structure.swings.filter((s) => s.confirmed && s.kind === (higherTimeframeBias === 'bullish' ? 'low' : 'high')).at(-1);
  const invalidationConditions = higherTimeframeBias === 'neutral' ? ['No directional higher-timeframe invalidation level is available until Daily and 4H align.'] : [latestSwing ? `${higherTimeframeBias === 'bullish' ? 'Bullish' : 'Bearish'} thesis invalidates on a confirmed ${options.breakMethod ?? 'close'} break beyond the latest opposing swing at ${latestSwing.price}.` : 'Define an opposing confirmed swing before treating a setup as actionable.', `A confirmed opposite-direction CHoCH invalidates the current ${higherTimeframeBias} candidate.`];
  if (state === 'Qualified') requiredConfirmation.push('Rule set met. Qualified describes these deterministic conditions only; it does not imply profitability.');
  if (state === 'Watch' && !valid) requiredConfirmation.push('Resolve malformed or incomplete candle data before interpreting any price levels.');
  const lowerFiltered = selectedCandles.filter((c) => options.includeForming || isClosed(c));
  return {
    symbol, analysisTimestamp: options.asOfTimestamp ?? options.now ?? Date.now(), timeframe, state, higherTimeframeBias, dailyBias, fourHourBias, lowerTimeframeStructure: structure.structure,
    structure, higherTimeframes: { daily, fourHour }, alignedCandles: [...alignHigherTimeframeCandles(lowerFiltered, dailyCandles, 'D'), ...alignHigherTimeframeCandles(lowerFiltered, fourHourCandles, '240')],
    relevantLiquidity: structure.liquidityPools.filter((p) => p.equal).slice(-10), fvgs: structure.fvgs.slice(-15), orderBlocks: structure.orderBlocks.slice(-15),
    supportingEvidence, conflictingEvidence, requiredConfirmation: activeCandidate || state === 'Watch' ? requiredConfirmation : [...requiredConfirmation, `Candidate state is ${state}.`], invalidationConditions,
    dataQuality: { valid, stale, issues },
    qualificationRule: `Qualified requires fresh valid closed candles, the profile's enabled alignment, sweep, zone-retest, a confirmed ${options.breakMethod ?? 'close'}-based BOS/CHoCH when required, and minimum ${minimumConfluence} of 5 confluence conditions. This is a rules result and does not imply profitability.`
  };
}
