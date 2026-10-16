import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/app/api/forex/rates/route';

const request = (query = '') => new Request(`http://localhost/api/forex/rates${query}`);

test('FX reference route validates input before calling Frankfurter', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('[]'); };
  try {
    const response = await GET(request('?base=US1&symbols=EUR'));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_base');
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('FX reference route returns validated, explicitly daily rates from the v2 API', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json([
      { date: '2026-10-16', base: 'USD', quote: 'EUR', rate: 0.89 },
      { date: '2026-10-16', base: 'USD', quote: 'JPY', rate: 158.1 },
      { date: '2026-10-16', base: 'GBP', quote: 'CAD', rate: 1.8 },
      { date: 'bad-date', base: 'USD', quote: 'CHF', rate: 0.82 },
    ]);
  };
  try {
    const response = await GET(request('?base=usd&symbols=EUR,JPY,CHF'));
    assert.equal(response.status, 200);
    assert.match(requestedUrl, /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?/);
    assert.equal(new URL(requestedUrl).searchParams.get('quotes'), 'EUR,JPY,CHF');
    const result = await response.json();
    assert.equal(result.kind, 'daily_reference_not_intraday');
    assert.equal(result.date, '2026-10-16');
    assert.deepEqual(result.rates, { EUR: 0.89, JPY: 158.1 });
    assert.deepEqual(result.missing, ['CHF']);
    assert.match(response.headers.get('Cache-Control') || '', /s-maxage=3600/);
  } finally { globalThis.fetch = originalFetch; }
});

test('FX reference route maps network, upstream, and malformed response failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('network'); };
    const network = await GET(request());
    assert.equal(network.status, 503);
    assert.equal((await network.json()).error, 'upstream_unreachable');

    globalThis.fetch = async () => new Response('unavailable', { status: 429 });
    const upstream = await GET(request());
    assert.equal(upstream.status, 502);
    assert.equal((await upstream.json()).error, 'upstream_error');

    globalThis.fetch = async () => new Response('not-json');
    const malformed = await GET(request());
    assert.equal(malformed.status, 502);
    assert.equal((await malformed.json()).error, 'invalid_upstream_response');
  } finally { globalThis.fetch = originalFetch; }
});
