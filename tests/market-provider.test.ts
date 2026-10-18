import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MarketDataError, MarketDataRegistry, TwelveDataForexProvider, BybitMarketDataProvider, createDefaultMarketDataRegistry } from '../src/lib/market/provider';
import { cryptoInstrument, forexInstrument } from '../src/lib/market/instrument';

const NOW = Date.UTC(2026, 0, 1, 12, 30);

function bybitService() {
  return {
    async getCandles(_category: string, symbol: string, _interval: string, _limit?: number) {
      return {
        candles: [
          { startTime: Date.UTC(2026, 0, 1, 11), open: 100, high: 110, low: 90, close: 105, volume: 12, closed: true },
          { startTime: Date.UTC(2026, 0, 1, 12), open: 105, high: 112, low: 100, close: 108, volume: 8, closed: false },
        ],
        lastUpdated: new Date(NOW).toISOString(),
        stale: false,
        source: 'Bybit V5 public REST' as const,
        symbol,
      };
    },
  };
}

function forexFetch(): typeof fetch {
  return (async (input: URL | string) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.twelvedata.com');
    assert.equal(url.searchParams.get('timezone'), 'UTC');
    assert.equal(url.searchParams.get('apikey'), 'test-key');
    return Response.json({
      meta: { symbol: 'EUR/USD' },
      values: [
        { datetime: '2026-01-01 11:00:00', open: '1.10', high: '1.12', low: '1.09', close: '1.11' },
        { datetime: '2026-01-01 12:00:00', open: '1.11', high: '1.13', low: '1.10', close: '1.12' },
      ],
    });
  }) as typeof fetch;
}

describe('provider-neutral market data', () => {
  it('serves crypto through the Bybit adapter with normalized candles', async () => {
    const registry = new MarketDataRegistry([new BybitMarketDataProvider(bybitService() as never)]);
    const series = await registry.getSeries('BTCUSDT', '1h', 30);
    assert.equal(series.instrument.assetClass, 'crypto');
    assert.equal(series.source, 'Bybit V5 public REST');
    assert.deepEqual(series.candles.map((candle) => candle.timestamp), [Date.UTC(2026, 0, 1, 11), Date.UTC(2026, 0, 1, 12)]);
    assert.equal(series.candles[1].closed, false);
  });

  it('serves forex through the Twelve Data adapter and reports volume as zero', async () => {
    const registry = new MarketDataRegistry([new TwelveDataForexProvider('test-key', forexFetch(), () => NOW)]);
    const series = await registry.getSeries('eurusd', '1h', 30);
    assert.equal(series.instrument.assetClass, 'forex');
    assert.equal(series.source, 'Twelve Data REST');
    assert.equal(series.candles.length, 2);
    assert.deepEqual(series.candles.map((candle) => candle.volume), [0, 0]);
    assert.match(series.freshness, /no true volume/i);
  });

  it('reports a controlled error when forex credentials are missing', async () => {
    const registry = new MarketDataRegistry([new TwelveDataForexProvider(undefined, forexFetch(), () => NOW)]);
    await assert.rejects(registry.getSeries('EUR/USD', '1h', 30), (error) => error instanceof MarketDataError && error.status === 503 && error.code === 'provider_not_configured');
  });

  it('rejects unknown instruments and unsupported timeframes before any network call', async () => {
    const registry = createDefaultMarketDataRegistry();
    await assert.rejects(registry.getSeries('', '1h', 30), (error) => error instanceof MarketDataError && error.code === 'unknown_instrument');
    await assert.rejects(registry.getSeries('BTCUSDT', '3m', 30), (error) => error instanceof MarketDataError && error.code === 'invalid_request');
    await assert.rejects(registry.getSeries('BTCUSDT', '1h', 5), (error) => error instanceof MarketDataError && error.code === 'invalid_request');
  });

  it('maps provider quota failures without pretending data exists', async () => {
    const limited: typeof fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch;
    const registry = new MarketDataRegistry([new TwelveDataForexProvider('test-key', limited, () => NOW)]);
    await assert.rejects(registry.getSeries('GBP/USD', '1h', 30), (error) => error instanceof MarketDataError && error.status === 429 && error.code === 'provider_limit');
  });

  it('detects a stale forex series whose latest candle is closed and old', async () => {
    const old: typeof fetch = (async () => Response.json({
      meta: { symbol: 'AUD/USD' },
      values: [{ datetime: '2026-01-01 05:00:00', open: '0.7', high: '0.71', low: '0.69', close: '0.705' }],
    })) as typeof fetch;
    const registry = new MarketDataRegistry([new TwelveDataForexProvider('test-key', old, () => NOW)]);
    const series = await registry.getSeries('AUD/USD', '1h', 30);
    assert.equal(series.stale, true);
  });

  it('refuses forex instruments on the crypto provider and vice versa', () => {
    const bybit = new BybitMarketDataProvider(bybitService() as never);
    const twelve = new TwelveDataForexProvider('test-key', forexFetch(), () => NOW);
    assert.equal(bybit.isSupported(forexInstrument('EUR/USD')), false);
    assert.equal(bybit.isSupported(cryptoInstrument('BTCUSDT')), true);
    assert.equal(twelve.isSupported(cryptoInstrument('BTCUSDT')), false);
    assert.equal(twelve.isSupported(forexInstrument('EUR/USD')), true);
  });
});
