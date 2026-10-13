import type { BybitCategory, MarketDataService } from '@/lib/market/bybit';
import { analyzeMultiTimeframe, type EngineOptions, type OHLCV, type SMCAssessment } from './engine';

export type SMCMarketRequest = { symbol: string; category: BybitCategory; timeframe: '30' | '60' };
export type SMCMarketResult = { analysis: SMCAssessment; lastSuccessfulUpdate: string; source: 'Bybit V5 public REST'; candles: { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] } };

/** Loads verified candles through the existing service boundary, then calls the pure engine. */
export async function analyzeFromMarketData(service: MarketDataService, request: SMCMarketRequest, options: EngineOptions = {}): Promise<SMCMarketResult> {
  const [daily, fourHour, oneHour, thirtyMinute] = await Promise.all([
    service.getCandles(request.category, request.symbol, 'D', 120),
    service.getCandles(request.category, request.symbol, '240', 120),
    service.getCandles(request.category, request.symbol, '60', 120),
    service.getCandles(request.category, request.symbol, '30', 120),
  ]);
  const map = (candles: typeof daily.candles): OHLCV[] => candles.map((candle) => ({ timestamp: candle.startTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, closed: candle.closed }));
  const candles = { daily: map(daily.candles), fourHour: map(fourHour.candles), oneHour: map(oneHour.candles), thirtyMinute: map(thirtyMinute.candles) };
  const analysis = analyzeMultiTimeframe({ symbol: request.symbol, timeframe: request.timeframe, candles, options });
  return { analysis, candles, lastSuccessfulUpdate: [daily, fourHour, oneHour, thirtyMinute].map((result) => result.lastUpdated).sort().at(-1) || new Date(options.now ?? Date.now()).toISOString(), source: 'Bybit V5 public REST' };
}
