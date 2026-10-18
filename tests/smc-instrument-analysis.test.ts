import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MarketDataRegistry, TwelveDataForexProvider } from '../src/lib/market/provider';
import { analyzeInstrument } from '../src/lib/smc/instrument-analysis';

const NOW = Date.UTC(2026, 0, 13);
const STEP_MINUTES: Record<string, number> = { '1day': 1440, '4h': 240, '1h': 60, '30min': 30 };

function forexFetch(): typeof fetch {
  return (async (input: URL | string) => {
    const url = new URL(String(input));
    const interval = url.searchParams.get('interval') || '1h';
    const step = STEP_MINUTES[interval] * 60_000;
    const count = Number(url.searchParams.get('outputsize') || 120);
    const values = Array.from({ length: count }, (_, index) => {
      const time = NOW - (count - 1 - index) * step;
      return { datetime: new Date(time).toISOString().slice(0, 19).replace('T', ' '), open: '1.1000', high: '1.1010', low: '1.0990', close: '1.1005' };
    });
    return Response.json({ meta: { symbol: 'EUR/USD', interval }, values });
  }) as typeof fetch;
}

describe('provider-neutral SMC analysis', () => {
  it('runs the SMC engine over forex candles from the neutral provider layer', async () => {
    const registry = new MarketDataRegistry([new TwelveDataForexProvider('test-key', forexFetch(), () => NOW)]);
    const result = await analyzeInstrument(registry, { symbol: 'EUR/USD', timeframe: '60' }, { now: NOW, maxDataAgeMs: 10 * 86_400_000, swingLeft: 1, swingRight: 1 });
    assert.equal(result.instrument.assetClass, 'forex');
    assert.equal(result.analysis.symbol, 'EUR/USD');
    assert.equal(result.analysis.structure.timeframe, '60');
    assert.equal(result.source, 'Twelve Data REST');
    assert.deepEqual(result.sources, ['Twelve Data REST']);
    assert.equal(result.candles.daily.length, 120);
    assert.equal(result.candles.thirtyMinute.length, 120);
    assert.ok(result.candles.thirtyMinute.every((candle) => candle.volume === 0));
  });

  it('rejects an unknown instrument instead of inventing a series', async () => {
    const registry = new MarketDataRegistry([new TwelveDataForexProvider('test-key', forexFetch(), () => NOW)]);
    await assert.rejects(analyzeInstrument(registry, { symbol: '!!!', timeframe: '60' }), /recognise that instrument/i);
  });
});
