import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/app/api/forex/candles/route';
import { parseTwelveDataCandles, validateForexRequest } from '../src/lib/market/twelve-data-forex';

test('validates supported forex pairs, intervals, and bounded candle counts', () => {
  assert.deepEqual(validateForexRequest('eurusd', '1h', '120'), { ok: true, pair: 'EUR/USD', interval: '1h', outputsize: 120 });
  assert.equal(validateForexRequest('BTCUSDT', '1h', '120').ok, false);
  assert.equal(validateForexRequest('EUR/USD', '3min', '120').ok, false);
  assert.equal(validateForexRequest('EUR/USD', '1h', '5000').ok, false);
});

test('parses, orders, deduplicates UTC candles, and distinguishes forming candles', () => {
  const result = parseTwelveDataCandles({
    meta: { symbol: 'EUR/USD', interval: '1h', exchange_timezone: 'UTC' },
    values: [
      { datetime: '2026-10-17 11:00:00', open: '1.1', high: '1.3', low: '1.0', close: '1.2' },
      { datetime: '2026-10-17 10:00:00', open: '1.0', high: '1.2', low: '0.9', close: '1.1' },
      { datetime: '2026-10-17 10:00:00', open: '1.0', high: '1.2', low: '0.9', close: '1.1' },
      { datetime: 'invalid', open: '1.0', high: '1.2', low: '0.9', close: '1.1' },
      { datetime: '2026-10-17 12:00:00', open: '1.2', high: '1.4', low: '1.1', close: '1.3' },
    ],
  }, 'EUR/USD', '1h', Date.parse('2026-10-17T12:30:00Z'));
  assert.equal(result?.length, 3);
  assert.deepEqual(result?.map((candle) => candle.closed), [true, true, false]);
  assert.ok((result?.[0].timestamp || 0) < (result?.[1].timestamp || 0));
});

test('rejects wrong-symbol, error, and wholly malformed provider responses', () => {
  assert.equal(parseTwelveDataCandles({ meta: { symbol: 'GBP/USD' }, values: [{ datetime: '2026-10-17 11:00:00', open: 1, high: 2, low: 0.5, close: 1 }] }, 'EUR/USD', '1h'), null);
  assert.equal(parseTwelveDataCandles({ status: 'error', message: 'API key invalid' }, 'EUR/USD', '1h'), null);
  assert.equal(parseTwelveDataCandles({ meta: { symbol: 'EUR/USD' }, values: [{ datetime: 'bad' }] }, 'EUR/USD', '1h'), null);
});

test('forex candle route validates before upstream access and reports missing API key', async () => {
  const invalid = await GET(new Request('http://localhost/api/forex/candles?pair=BTCUSDT&interval=1h'));
  assert.equal(invalid.status, 400);
  const previous = process.env.TWELVE_DATA_API_KEY;
  delete process.env.TWELVE_DATA_API_KEY;
  try {
    const response = await GET(new Request('http://localhost/api/forex/candles?pair=EUR%2FUSD&interval=1h'));
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /TWELVE_DATA_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.TWELVE_DATA_API_KEY = previous;
  }
});

test('forex candle route returns validated candles and surfaces provider quota errors', async () => {
  const originalKey = process.env.TWELVE_DATA_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.TWELVE_DATA_API_KEY = 'test-only-key';
  let status = 200;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.twelvedata.com');
    assert.equal(url.searchParams.get('timezone'), 'UTC');
    assert.ok(['EUR/USD', 'GBP/USD'].includes(url.searchParams.get('symbol') || ''));
    return new Response(JSON.stringify(status === 200 ? {
      meta: { symbol: 'EUR/USD' },
      values: [{ datetime: '2026-10-17 10:00:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' }],
    } : { code: 429, message: 'API credits exhausted', status: 'error' }), { status });
  };
  try {
    const good = await GET(new Request('http://localhost/api/forex/candles?pair=EUR%2FUSD&interval=1h'));
    assert.equal(good.status, 200);
    assert.equal((await good.json()).candles.length, 1);
    status = 429;
    const limited = await GET(new Request('http://localhost/api/forex/candles?pair=GBP%2FUSD&interval=1h'));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'provider_limit');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = originalKey;
  }
});
