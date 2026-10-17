import { NextResponse } from 'next/server';
import { parseTwelveDataCandles, validateForexRequest, type TwelveDataPayload } from '@/lib/market/twelve-data-forex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cache = new Map<string, { expiresAt: number; body: unknown }>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const validated = validateForexRequest(params.get('pair'), params.get('interval'), params.get('outputsize'));
  if (!validated.ok) return NextResponse.json({ error: 'invalid_request', message: validated.error }, { status: 400 });
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: 'provider_not_configured', message: 'Forex intraday candles need a Twelve Data API key. Add TWELVE_DATA_API_KEY on the server.' }, { status: 503 });
  const cacheKey = `${validated.pair}:${validated.interval}:${validated.outputsize}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store', 'X-Orion-Cache': 'HIT' } });
  for (const [key, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(key);

  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', validated.pair);
  url.searchParams.set('interval', validated.interval);
  url.searchParams.set('outputsize', String(validated.outputsize));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('order', 'ASC');
  url.searchParams.set('apikey', apiKey);
  let response: Response;
  try { response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000), cache: 'no-store' }); }
  catch { return NextResponse.json({ error: 'upstream_unreachable', message: 'Twelve Data forex candles are temporarily unavailable. Retry shortly.' }, { status: 503 }); }
  if (!response.ok) return NextResponse.json({ error: response.status === 429 ? 'provider_limit' : 'upstream_error', message: response.status === 429 ? 'Twelve Data quota is temporarily exhausted. Retry after the provider quota resets.' : `Twelve Data returned HTTP ${response.status}.` }, { status: response.status === 429 ? 429 : 502 });
  let payload: TwelveDataPayload;
  try { payload = await response.json() as TwelveDataPayload; }
  catch { return NextResponse.json({ error: 'invalid_upstream_response', message: 'Twelve Data returned unreadable candle data.' }, { status: 502 }); }
  if (payload.status === 'error') {
    const limited = payload.code === 429 || /limit|credits|api key/i.test(payload.message || '');
    return NextResponse.json({ error: limited ? 'provider_limit' : 'upstream_error', message: limited ? 'Twelve Data rejected the request because of its API key or quota. Check the server key and free-plan allowance.' : 'Twelve Data could not provide this forex series.' }, { status: limited ? 429 : 502 });
  }
  const candles = parseTwelveDataCandles(payload, validated.pair, validated.interval);
  if (!candles) return NextResponse.json({ error: 'invalid_upstream_response', message: 'Twelve Data returned no valid candles for this pair and interval.' }, { status: 502 });
  const body = { pair: validated.pair, interval: validated.interval, candles, source: 'Twelve Data REST', fetchedAt: new Date().toISOString(), freshness: 'Provider reports forex data as real-time; REST candles may arrive about 0.3–2 minutes after a candle closes.' };
  if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, { expiresAt: Date.now() + 60_000, body });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Orion-Cache': 'MISS' } });
}
