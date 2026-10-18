import type { BybitCategory } from '@/lib/market/bybit';
import { MarketDataError, type CandleSeries, type MarketDataRegistry } from '@/lib/market/provider';
import { resolveInstrument, type Instrument } from '@/lib/market/instrument';
import { analyzeMultiTimeframe, type EngineOptions, type OHLCV, type SMCAssessment } from './engine';

export type InstrumentCandleBundle = { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] };
export type InstrumentAnalysisResult = {
  instrument: Instrument;
  analysis: SMCAssessment;
  candles: InstrumentCandleBundle;
  sources: string[];
  lastSuccessfulUpdate: string;
  stale: boolean;
  source: string;
};

function toOhlcv(series: CandleSeries): OHLCV[] {
  return series.candles.map((candle) => ({ timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, closed: candle.closed }));
}

/**
 * Loads the four engine timeframes for any supported instrument through the provider-neutral
 * boundary, then runs the pure SMC engine. Crypto uses Bybit; forex uses Twelve Data.
 */
export async function analyzeInstrument(
  registry: MarketDataRegistry,
  request: { symbol: string; timeframe: '30' | '60'; category?: BybitCategory },
  options: EngineOptions = {},
): Promise<InstrumentAnalysisResult> {
  const instrument = resolveInstrument(request.symbol, undefined, request.category ?? 'linear');
  if (!instrument) throw new MarketDataError('Could not recognise that instrument. Use a crypto symbol like BTCUSDT or a supported forex pair like EUR/USD.', 400, 'unknown_instrument');
  const [daily, fourHour, oneHour, thirtyMinute] = await Promise.all([
    registry.getSeriesForInstrument(instrument, '1d', 120),
    registry.getSeriesForInstrument(instrument, '4h', 120),
    registry.getSeriesForInstrument(instrument, '1h', 120),
    registry.getSeriesForInstrument(instrument, '30m', 120),
  ]);
  const candles: InstrumentCandleBundle = { daily: toOhlcv(daily), fourHour: toOhlcv(fourHour), oneHour: toOhlcv(oneHour), thirtyMinute: toOhlcv(thirtyMinute) };
  const analysis = analyzeMultiTimeframe({ symbol: instrument.displaySymbol, timeframe: request.timeframe, candles, options });
  const series = [daily, fourHour, oneHour, thirtyMinute];
  return {
    instrument,
    analysis,
    candles,
    sources: [...new Set(series.map((item) => item.source))],
    lastSuccessfulUpdate: series.map((item) => item.fetchedAt).sort().at(-1) || new Date(options.now ?? Date.now()).toISOString(),
    stale: series.some((item) => item.stale),
    source: instrument.provider === 'bybit' ? 'Bybit V5 public REST' : 'Twelve Data REST',
  };
}
