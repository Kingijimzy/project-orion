import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BybitPublicMarketData, MarketDataError, clearBybitCachesForTests, parseBybitCandles, parseBybitSymbols } from '../src/lib/market/bybit';

const now = Date.UTC(2026, 0, 1, 12, 37);
const candle = (start: number, open = '100', high = '110', low = '90', close = '105') => [String(start), open, high, low, close, '12.5', '1200'];
const payload = (list: unknown[], retCode = 0) => ({ retCode, retMsg: retCode ? 'error' : 'OK', time: now, result: { category: 'linear', symbol: 'BTCUSDT', list } });

describe('Bybit market data', () => {
  it('parses and orders candles and marks forming versus closed candles', () => {
    const result = parseBybitCandles(payload([candle(Date.UTC(2026, 0, 1, 12)), candle(Date.UTC(2026, 0, 1, 11))]), '60', now);
    assert.deepEqual(result.candles.map((item) => item.startTime), [Date.UTC(2026, 0, 1, 11), Date.UTC(2026, 0, 1, 12)]);
    assert.equal(result.candles[0].closed, true);
    assert.equal(result.candles[1].closed, false);
    assert.equal(result.stale, false);
  });

  it('rejects malformed rows, invalid prices, and duplicate timestamps', () => {
    assert.throws(() => parseBybitCandles({ retCode: 0, result: { list: [['bad']] } }, '60', now), (error) => error instanceof MarketDataError && error.code === 'malformed_response');
    assert.throws(() => parseBybitCandles(payload([candle(now, '100', '95', '90', '105')]), '60', now), (error) => error instanceof MarketDataError && error.code === 'invalid_candle');
    assert.throws(() => parseBybitCandles(payload([candle(Date.UTC(2026, 0, 1, 11)), candle(Date.UTC(2026, 0, 1, 11))]), '60', now), (error) => error instanceof MarketDataError && error.code === 'duplicate_candle');
  });

  it('marks a structurally valid but stale response', () => {
    const stale = parseBybitCandles(payload([candle(Date.UTC(2026, 0, 1, 8))]), '60', now);
    assert.equal(stale.stale, true);
  });

  it('uses public V5 requests and serves repeated candle requests from cache', async () => {
    clearBybitCachesForTests();
    let calls = 0;
    const fetcher: typeof fetch = async (input) => {
      calls += 1;
      assert.match(String(input), /^https:\/\/api\.bybit\.com\/v5\/market\/kline\?/);
      return Response.json(payload([candle(Date.UTC(2026, 0, 1, 12)), candle(Date.UTC(2026, 0, 1, 11))]));
    };
    const service = new BybitPublicMarketData(fetcher, () => now);
    const first = await service.getCandles('linear', 'BTCUSDT', '60', 2);
    const second = await service.getCandles('linear', 'BTCUSDT', '60', 2);
    assert.equal(calls, 1);
    assert.equal(first.source, 'Bybit V5 public REST');
    assert.equal(second.lastUpdated, first.lastUpdated);
  });

  it('maps Bybit and HTTP rate limits without caching an error', async () => {
    clearBybitCachesForTests();
    const service = new BybitPublicMarketData(async () => Response.json(payload([], 10006)), () => now);
    await assert.rejects(service.getCandles('linear', 'BTCUSDT', '60'), (error) => error instanceof MarketDataError && error.status === 429);
  });

  it('filters symbol catalogues to active, valid products', () => {
    const symbols = parseBybitSymbols({ retCode: 0, result: { list: [
      { symbol: 'BTCUSDT', status: 'Trading', baseCoin: 'BTC', quoteCoin: 'USDT' },
      { symbol: 'OLDUSDT', status: 'Settled', baseCoin: 'OLD', quoteCoin: 'USDT' },
      { symbol: 'bad!', status: 'Trading', baseCoin: 'bad', quoteCoin: 'USDT' },
    ] } }, 'linear');
    assert.deepEqual(symbols.map((item) => item.symbol), ['BTCUSDT']);
  });
});
