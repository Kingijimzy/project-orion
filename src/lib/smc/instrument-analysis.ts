import { MarketDataError, type CandleSeries, type MarketDataRegistry } from '@/lib/market/provider';
import { resolveInstrument, type Instrument, type Timeframe } from '@/lib/market/instrument';
import type { BybitCategory } from '@/lib/market/bybit';
import { analyzeMultiTimeframe, type EngineOptions, type OHLCV, type SMCAssessment } from './engine';

export type InstrumentCandleBundle = { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] };
export type FrameLimits = { daily: number; fourHour: number; oneHour: number; thirtyMinute: number };
export type LoadedInstrument = { candles: InstrumentCandleBundle; lastSuccessfulUpdate: string; source: string; stale: boolean; sources: string[] };
export type InstrumentAnalysisResult = LoadedInstrument & { instrument: Instrument; analysis: SMCAssessment };

const FRAMES: Array<{ key: keyof InstrumentCandleBundle; timeframe: Timeframe }> = [
  { key: 'daily', timeframe: '1d' },
  { key: 'fourHour', timeframe: '4h' },
  { key: 'oneHour', timeframe: '1h' },
  { key: 'thirtyMinute', timeframe: '30m' },
];

function toOhlcv(series: CandleSeries): OHLCV[] {
  return series.candles.map((candle) => ({ timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, closed: candle.closed }));
}

export function resolveInstrumentOrThrow(symbol: string, category?: BybitCategory): Instrument {
  const instrument = resolveInstrument(symbol, undefined, category ?? 'linear');
  if (!instrument) throw new MarketDataError('Could not recognise that instrument. Use a crypto symbol like BTCUSDT or a supported forex pair like EUR/USD.', 400, 'unknown_instrument');
  return instrument;
}

/** Loads the four engine timeframes for any supported instrument through the provider-neutral boundary. */
export async function loadInstrumentCandles(registry: MarketDataRegistry, instrument: Instrument, limits: FrameLimits): Promise<LoadedInstrument> {
  const series = await Promise.all(FRAMES.map((frame) => registry.getSeriesForInstrument(instrument, frame.timeframe, limits[frame.key])));
  const candles = {} as InstrumentCandleBundle;
  FRAMES.forEach((frame, index) => { candles[frame.key] = toOhlcv(series[index]); });
  const source = instrument.provider === 'bybit' ? 'Bybit V5 public REST' : 'Twelve Data REST';
  return {
    candles,
    sources: [...new Set(series.map((item) => item.source))],
    lastSuccessfulUpdate: series.map((item) => item.fetchedAt).sort().at(-1) || new Date().toISOString(),
    stale: series.some((item) => item.stale),
    source,
  };
}

/**
 * Loads four timeframes for any supported instrument through the provider-neutral
 * boundary, then runs the pure SMC engine. Crypto uses Bybit; forex uses Twelve Data.
 */
export async function analyzeInstrument(
  registry: MarketDataRegistry,
  request: { symbol: string; timeframe: '30' | '60'; category?: BybitCategory },
  options: EngineOptions = {},
): Promise<InstrumentAnalysisResult> {
  const instrument = resolveInstrumentOrThrow(request.symbol, request.category);
  const loaded = await loadInstrumentCandles(registry, instrument, { daily: 120, fourHour: 120, oneHour: 120, thirtyMinute: 120 });
  const analysis = analyzeMultiTimeframe({ symbol: instrument.assetClass === 'forex' ? instrument.displaySymbol : instrument.symbol, timeframe: request.timeframe, candles: loaded.candles, options });
  return { instrument, analysis, ...loaded };
}
