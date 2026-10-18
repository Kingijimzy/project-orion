import { BybitPublicMarketData, MarketDataError, type BybitCategory, type BybitInterval } from './bybit';
import { FOREX_PAIRS, parseTwelveDataCandles, type ForexInterval, type ForexPair, type TwelveDataPayload } from './twelve-data-forex';
import { isTimeframe, resolveInstrument, type AssetClass, type Instrument, type ProviderId, type Timeframe } from './instrument';

export { MarketDataError } from './bybit';

export type NormalizedCandle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean };
export type CandleSeries = {
  instrument: Instrument;
  timeframe: Timeframe;
  candles: NormalizedCandle[];
  source: string;
  fetchedAt: string;
  stale: boolean;
  freshness: string;
};

export interface MarketDataProvider {
  readonly id: ProviderId;
  readonly assetClass: AssetClass;
  readonly sourceLabel: string;
  isSupported(instrument: Instrument): boolean;
  getSeries(instrument: Instrument, timeframe: Timeframe, limit: number): Promise<CandleSeries>;
}

const BYBIT_INTERVALS: Record<Timeframe, BybitInterval> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
const TWELVE_DATA_INTERVALS: Record<Timeframe, ForexInterval> = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1day' };

export class BybitMarketDataProvider implements MarketDataProvider {
  readonly id = 'bybit' as const;
  readonly assetClass = 'crypto' as const;
  readonly sourceLabel = 'Bybit V5 public REST';
  constructor(private readonly service: MarketDataServiceLike = new BybitPublicMarketData()) {}
  isSupported(instrument: Instrument): boolean {
    return instrument.assetClass === 'crypto' && /^[A-Z0-9]{2,30}$/.test(instrument.symbol);
  }
  async getSeries(instrument: Instrument, timeframe: Timeframe, limit: number): Promise<CandleSeries> {
    const category: BybitCategory = instrument.category ?? 'linear';
    const result = await this.service.getCandles(category, instrument.symbol, BYBIT_INTERVALS[timeframe], limit);
    return {
      instrument,
      timeframe,
      candles: result.candles.map((candle) => ({ timestamp: candle.startTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, closed: candle.closed })),
      source: result.source,
      fetchedAt: result.lastUpdated,
      stale: result.stale,
      freshness: 'Public exchange REST candles. A closed candle is final; the newest candle may still be forming.',
    };
  }
}

type MarketDataServiceLike = { getCandles(category: BybitCategory, symbol: string, interval: BybitInterval, limit?: number): Promise<{ candles: Array<{ startTime: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }>; lastUpdated: string; stale: boolean; source: 'Bybit V5 public REST' }> };

export class TwelveDataForexProvider implements MarketDataProvider {
  readonly id = 'twelve-data' as const;
  readonly assetClass = 'forex' as const;
  readonly sourceLabel = 'Twelve Data REST';
  constructor(private readonly apiKey = process.env.TWELVE_DATA_API_KEY?.trim(), private readonly fetcher: typeof fetch = fetch, private readonly clock: () => number = Date.now) {}
  isSupported(instrument: Instrument): boolean {
    return instrument.assetClass === 'forex' && (FOREX_PAIRS as readonly string[]).includes(instrument.symbol);
  }
  async getSeries(instrument: Instrument, timeframe: Timeframe, limit: number): Promise<CandleSeries> {
    if (!this.apiKey) throw new MarketDataError('Forex intraday candles need a Twelve Data API key. Add TWELVE_DATA_API_KEY on the server.', 503, 'provider_not_configured');
    const pair = instrument.symbol as ForexPair;
    const interval = TWELVE_DATA_INTERVALS[timeframe];
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', pair);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(limit));
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('order', 'ASC');
    url.searchParams.set('apikey', this.apiKey);
    let response: Response;
    try { response = await this.fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000), cache: 'no-store' }); }
    catch { throw new MarketDataError('Twelve Data forex candles are temporarily unavailable. Retry shortly.', 503, 'upstream_unreachable'); }
    if (response.status === 429) throw new MarketDataError('Twelve Data quota is temporarily exhausted. Retry after the provider quota resets.', 429, 'provider_limit');
    if (!response.ok) throw new MarketDataError(`Twelve Data returned HTTP ${response.status}.`, 502, 'upstream_error');
    let payload: TwelveDataPayload;
    try { payload = await response.json() as TwelveDataPayload; }
    catch { throw new MarketDataError('Twelve Data returned unreadable candle data.', 502, 'invalid_upstream_response'); }
    if (payload.status === 'error') {
      const limited = payload.code === 429 || /limit|credits|api key/i.test(payload.message || '');
      throw new MarketDataError(limited ? 'Twelve Data rejected the request because of its API key or quota. Check the server key and free-plan allowance.' : 'Twelve Data could not provide this forex series.', limited ? 429 : 502, limited ? 'provider_limit' : 'upstream_error');
    }
    const parsed = parseTwelveDataCandles(payload, pair, interval, this.clock());
    if (!parsed) throw new MarketDataError('Twelve Data returned no valid candles for this pair and interval.', 502, 'invalid_upstream_response');
    const candles: NormalizedCandle[] = parsed.map((candle) => ({ ...candle, volume: 0 }));
    const latest = candles[candles.length - 1];
    const stale = candles.every((candle) => candle.closed) && latest.timestamp + intervalMs(timeframe) * 3 < this.clock();
    return {
      instrument,
      timeframe,
      candles,
      source: this.sourceLabel,
      fetchedAt: new Date(this.clock()).toISOString(),
      stale,
      freshness: 'Provider reports forex data as real-time; free-plan REST candles may arrive about 0.3–2 minutes after a candle closes. Forex has no true volume, so volume is reported as 0.',
    };
  }
}

function intervalMs(timeframe: Timeframe): number {
  const minutes: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
  return minutes[timeframe] * 60_000;
}

export class MarketDataRegistry {
  private readonly providers = new Map<AssetClass, MarketDataProvider>();
  constructor(providers: MarketDataProvider[]) {
    for (const provider of providers) this.providers.set(provider.assetClass, provider);
  }
  providerFor(assetClass: AssetClass): MarketDataProvider | null {
    return this.providers.get(assetClass) ?? null;
  }
  async getSeries(input: string, timeframe: string, limit: number, category: BybitCategory = 'linear'): Promise<CandleSeries> {
    const instrument = resolveInstrument(input, undefined, category);
    if (!instrument) throw new MarketDataError('Could not recognise that instrument. Use a crypto symbol like BTCUSDT or a supported forex pair like EUR/USD.', 400, 'unknown_instrument');
    return this.getSeriesForInstrument(instrument, timeframe, limit);
  }
  async getSeriesForInstrument(instrument: Instrument, timeframe: string, limit: number): Promise<CandleSeries> {
    if (!isTimeframe(timeframe)) throw new MarketDataError('Choose a supported candle timeframe.', 400, 'invalid_request');
    if (!Number.isInteger(limit) || limit < 20 || limit > 1000) throw new MarketDataError('Candle count must be a whole number between 20 and 1000.', 400, 'invalid_request');
    const provider = this.providerFor(instrument.assetClass);
    if (!provider) throw new MarketDataError(`No market-data provider is configured for ${instrument.assetClass}.`, 503, 'provider_unavailable');
    if (!provider.isSupported(instrument)) throw new MarketDataError('That instrument is not supported by the configured provider.', 400, 'unsupported_instrument');
    return provider.getSeries(instrument, timeframe, limit);
  }
}

export function createDefaultMarketDataRegistry(): MarketDataRegistry {
  return new MarketDataRegistry([new BybitMarketDataProvider(), new TwelveDataForexProvider()]);
}
