export type BybitCategory = 'spot' | 'linear' | 'inverse';
export type BybitInterval = '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '360' | '720' | 'D' | 'W' | 'M';
export type Candle = { startTime: number; open: number; high: number; low: number; close: number; volume: number; turnover: number; closed: boolean };
export type CandleResult = { category: BybitCategory; symbol: string; interval: BybitInterval; candles: Candle[]; lastUpdated: string; stale: boolean; source: 'Bybit V5 public REST' };
export type MarketSymbol = { symbol: string; baseCoin: string; quoteCoin: string; category: BybitCategory };
export type MarketTicker = { category: BybitCategory; symbol: string; lastPrice: number; change24h: number | null; high24h: number | null; low24h: number | null; volume24h: number | null; turnover24h: number | null; updatedAt: string; source: 'Bybit V5 public REST' };

export interface MarketDataService {
  getCandles(category: BybitCategory, symbol: string, interval: BybitInterval, limit?: number): Promise<CandleResult>;
  searchSymbols(category: BybitCategory, query: string): Promise<MarketSymbol[]>;
}

export class MarketDataError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'market_data_error') { super(message); this.name = 'MarketDataError'; }
}

const intervals: BybitInterval[] = ['1','3','5','15','30','60','120','240','360','720','D','W','M'];
const categories: BybitCategory[] = ['spot','linear','inverse'];
export function isBybitCategory(value: string): value is BybitCategory { return categories.includes(value as BybitCategory); }
export function isBybitInterval(value: string): value is BybitInterval { return intervals.includes(value as BybitInterval); }
export function intervalStartTime(time: number, interval: BybitInterval): number {
  const date = new Date(time);
  if (interval === 'M') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  if (interval === 'W') {
    const day = date.getUTCDay() || 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1);
  }
  if (interval === 'D') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const minutes = Number(interval);
  const ms = minutes * 60_000;
  return Math.floor(time / ms) * ms;
}
export function intervalEndTime(start: number, interval: BybitInterval): number {
  if (interval === 'M') { const date = new Date(start); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1); }
  if (interval === 'W') return start + 7 * 86_400_000;
  if (interval === 'D') return start + 86_400_000;
  return start + Number(interval) * 60_000;
}
function finitePositive(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBybitCandles(payload: unknown, interval: BybitInterval, now = Date.now()): { candles: Candle[]; stale: boolean } {
  if (!payload || typeof payload !== 'object') throw new MarketDataError('Bybit returned a malformed candle response.', 502, 'malformed_response');
  const body = payload as { retCode?: unknown; retMsg?: unknown; time?: unknown; result?: { list?: unknown } };
  if (body.retCode !== 0) {
    if (body.retCode === 10006 || body.retCode === 10429) throw new MarketDataError('Bybit rate limit reached. Wait briefly before refreshing.', 429, 'rate_limited');
    throw new MarketDataError(typeof body.retMsg === 'string' ? `Bybit request failed (${String(body.retCode)}).` : 'Bybit rejected the candle request.', 502, 'upstream_error');
  }
  const rows = body.result?.list;
  if (!Array.isArray(rows) || !rows.length) throw new MarketDataError('Bybit returned no candle data for this selection.', 502, 'empty_response');
  const parsed: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) throw new MarketDataError('Bybit returned a malformed candle row.', 502, 'malformed_response');
    const startTime = finitePositive(row[0]);
    const open = finitePositive(row[1]); const high = finitePositive(row[2]); const low = finitePositive(row[3]);
    const close = finitePositive(row[4]); const volume = finitePositive(row[5]); const turnover = finitePositive(row[6]);
    if (startTime === null || open === null || high === null || low === null || close === null || volume === null || turnover === null || open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new MarketDataError('Bybit returned invalid timestamp or price data.', 502, 'invalid_candle');
    }
    if (!Number.isSafeInteger(startTime) || startTime > now + 60_000) throw new MarketDataError('Bybit returned an invalid candle timestamp.', 502, 'invalid_timestamp');
    parsed.push({ startTime, open, high, low, close, volume, turnover, closed: intervalEndTime(startTime, interval) <= now });
  }
  parsed.sort((a, b) => a.startTime - b.startTime);
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].startTime === parsed[index - 1].startTime) throw new MarketDataError('Bybit returned duplicate candle timestamps.', 502, 'duplicate_candle');
  }
  const latest = parsed[parsed.length - 1];
  const staleAllowance = interval === 'M' ? 62 * 86_400_000 : interval === 'W' ? 14 * 86_400_000 : interval === 'D' ? 2 * 86_400_000 : Number(interval) * 120_000;
  const stale = now - latest.startTime > staleAllowance;
  return { candles: parsed, stale };
}

type CacheItem<T> = { expires: number; value: T };
const candleCache = new Map<string, CacheItem<CandleResult>>();
const symbolCache = new Map<BybitCategory, CacheItem<MarketSymbol[]>>();
const tickerCache = new Map<string, CacheItem<MarketTicker>>();
const CANDLE_CACHE_MS = 15_000;
const SYMBOL_CACHE_MS = 5 * 60_000;
const TICKER_CACHE_MS = 5_000;
const BASE_URL = 'https://api.bybit.com';

export class BybitPublicMarketData implements MarketDataService {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly clock: () => number = Date.now) {}
  async getTicker(category: BybitCategory, symbol: string): Promise<MarketTicker> {
    if (!isBybitCategory(category) || !/^[A-Z0-9]{2,30}$/.test(symbol)) throw new MarketDataError('Choose a valid Bybit market and symbol.', 400, 'invalid_request');
    const key = `${category}:${symbol}`;
    const cached = tickerCache.get(key);
    if (cached && cached.expires > this.clock()) return cached.value;
    const url = new URL(`${BASE_URL}/v5/market/tickers`);
    url.search = new URLSearchParams({ category, symbol }).toString();
    const response = await this.request(url);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new MarketDataError('Bybit returned an unreadable ticker response.', 502, 'malformed_response'); }
    const ticker = parseBybitTicker(payload, category, symbol, this.clock());
    tickerCache.set(key, { value: ticker, expires: this.clock() + TICKER_CACHE_MS });
    return ticker;
  }
  async getCandles(category: BybitCategory, symbol: string, interval: BybitInterval, limit = 100): Promise<CandleResult> {
    if (!isBybitCategory(category) || !isBybitInterval(interval) || !/^[A-Z0-9]{2,30}$/.test(symbol) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MarketDataError('Choose a valid Bybit market, symbol, timeframe, and candle count.', 400, 'invalid_request');
    }
    const key = `${category}:${symbol}:${interval}:${limit}`;
    const cached = candleCache.get(key);
    if (cached && cached.expires > this.clock()) return cached.value;
    const url = new URL(`${BASE_URL}/v5/market/kline`);
    url.search = new URLSearchParams({ category, symbol, interval, limit: String(limit) }).toString();
    const response = await this.request(url);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new MarketDataError('Bybit returned an unreadable candle response.', 502, 'malformed_response'); }
    const parsed = parseBybitCandles(payload, interval, this.clock());
    const result: CandleResult = { category, symbol, interval, candles: parsed.candles, lastUpdated: new Date(this.clock()).toISOString(), stale: parsed.stale, source: 'Bybit V5 public REST' };
    candleCache.set(key, { value: result, expires: this.clock() + CANDLE_CACHE_MS });
    return result;
  }
  async searchSymbols(category: BybitCategory, query: string): Promise<MarketSymbol[]> {
    const normalized = query.trim().toUpperCase();
    if (normalized.length > 40) throw new MarketDataError('Symbol search is too long.', 400, 'invalid_request');
    let symbols: MarketSymbol[];
    const cached = symbolCache.get(category);
    if (cached && cached.expires > this.clock()) symbols = cached.value;
    else {
      const url = new URL(`${BASE_URL}/v5/market/instruments-info`);
      url.search = new URLSearchParams({ category, limit: '1000' }).toString();
      const response = await this.request(url);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new MarketDataError('Bybit returned an unreadable symbol response.', 502, 'malformed_response'); }
      symbols = parseBybitSymbols(payload, category);
      symbolCache.set(category, { value: symbols, expires: this.clock() + SYMBOL_CACHE_MS });
    }
    return symbols.filter((item) => !normalized || item.symbol.includes(normalized) || item.baseCoin.includes(normalized)).slice(0, 30);
  }
  private async request(url: URL): Promise<Response> {
    let response: Response;
    try { response = await this.fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) }); }
    catch { throw new MarketDataError('Could not reach Bybit public market data. Check the network and retry.', 503, 'network_error'); }
    if (response.status === 429) throw new MarketDataError('Bybit rate limit reached. Wait briefly before refreshing.', 429, 'rate_limited');
    if (!response.ok) throw new MarketDataError(`Bybit public market data returned HTTP ${response.status}.`, 502, 'upstream_error');
    return response;
  }
}

export function parseBybitSymbols(payload: unknown, category: BybitCategory): MarketSymbol[] {
  if (!payload || typeof payload !== 'object') throw new MarketDataError('Bybit returned a malformed symbol catalogue.', 502, 'malformed_response');
  const body = payload as { retCode?: unknown; retMsg?: unknown; result?: { list?: unknown } };
  if (body.retCode !== 0) {
    if (body.retCode === 10006 || body.retCode === 10429) throw new MarketDataError('Bybit rate limit reached. Wait briefly before searching again.', 429, 'rate_limited');
    throw new MarketDataError('Bybit rejected the symbol search request.', 502, 'upstream_error');
  }
  if (!Array.isArray(body.result?.list)) throw new MarketDataError('Bybit returned a malformed symbol catalogue.', 502, 'malformed_response');
  return (body.result.list as Array<Record<string, unknown>>).flatMap((item) => {
    if (typeof item.symbol !== 'string' || !/^[A-Z0-9]{2,30}$/.test(item.symbol) || item.status !== 'Trading') return [];
    const baseCoin = typeof item.baseCoin === 'string' ? item.baseCoin : item.symbol.replace(/(USDT|USDC|USD|BTC|ETH)$/, '');
    const quoteCoin = typeof item.quoteCoin === 'string' ? item.quoteCoin : '';
    if (category !== 'spot' && quoteCoin && !['USDT','USDC','USD'].includes(quoteCoin)) return [];
    return [{ symbol: item.symbol, baseCoin, quoteCoin, category }];
  });
}

export function parseBybitTicker(payload: unknown, category: BybitCategory, symbol: string, now = Date.now()): MarketTicker {
  if (!payload || typeof payload !== 'object') throw new MarketDataError('Bybit returned a malformed ticker response.', 502, 'malformed_response');
  const body = payload as { retCode?: unknown; retMsg?: unknown; result?: { list?: unknown } };
  if (body.retCode !== 0) {
    if (body.retCode === 10006 || body.retCode === 10429) throw new MarketDataError('Bybit rate limit reached. Wait briefly before refreshing.', 429, 'rate_limited');
    throw new MarketDataError('Bybit rejected the ticker request.', 502, 'upstream_error');
  }
  const rows = body.result?.list;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw new MarketDataError('Bybit returned no ticker for this symbol.', 502, 'empty_response');
  const row = rows[0] as Record<string, unknown>;
  const lastPrice = finitePositive(row.lastPrice);
  if (row.symbol !== symbol || lastPrice === null || lastPrice <= 0) throw new MarketDataError('Bybit returned invalid ticker data.', 502, 'invalid_ticker');
  const optional = (key: string) => { const value = row[key]; if (value === undefined || value === null || value === '') return null; const parsed = finitePositive(value); return parsed === null ? null : parsed; };
  const change24h = row.price24hPcnt === undefined || row.price24hPcnt === null || row.price24hPcnt === '' ? null : finiteNumber(row.price24hPcnt);
  if (row.price24hPcnt !== undefined && row.price24hPcnt !== null && row.price24hPcnt !== '' && change24h === null) throw new MarketDataError('Bybit returned invalid 24-hour ticker change.', 502, 'invalid_ticker');
  return { category, symbol, lastPrice, change24h, high24h: optional('highPrice24h'), low24h: optional('lowPrice24h'), volume24h: optional('volume24h'), turnover24h: optional('turnover24h'), updatedAt: new Date(now).toISOString(), source: 'Bybit V5 public REST' };
}

export function clearBybitCachesForTests() { candleCache.clear(); symbolCache.clear(); tickerCache.clear(); }
