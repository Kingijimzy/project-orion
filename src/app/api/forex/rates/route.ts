import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Frankfurter publishes daily reference exchange rates, not executable/intraday FX quotes.
// Use the current v2 API and label the values so the UI cannot present them as live prices.
const BASE_URL = 'https://api.frankfurter.dev/v2/rates';
const CURRENCY_CODE = /^[A-Z]{3}$/;
const DEFAULT_BASE = 'USD';
const DEFAULT_SYMBOLS = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

type FrankfurterRow = { date?: string; base?: string; quote?: string; rate?: number };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const base = (params.get('base') || DEFAULT_BASE).trim().toUpperCase();
  const rawSymbols = params.get('symbols');
  const symbols = (rawSymbols
    ? rawSymbols.split(',')
    : DEFAULT_SYMBOLS)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  if (!CURRENCY_CODE.test(base)) {
    return NextResponse.json(
      { error: 'invalid_base', message: 'Base must be a three-letter currency code.' },
      { status: 400 },
    );
  }

  if (!symbols.length || symbols.length > 20 || symbols.some((code) => !CURRENCY_CODE.test(code))) {
    return NextResponse.json(
      { error: 'invalid_symbols', message: 'Provide between 1 and 20 comma-separated three-letter currency codes.' },
      { status: 400 },
    );
  }

  const uniqueSymbols = [...new Set(symbols)].filter((code) => code !== base);
  if (!uniqueSymbols.length) {
    return NextResponse.json(
      { error: 'empty_symbols', message: 'Choose at least one currency different from the base.' },
      { status: 400 },
    );
  }

  const url = new URL(BASE_URL);
  url.searchParams.set('base', base);
  url.searchParams.set('quotes', uniqueSymbols.join(','));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: 'Daily FX reference rates are temporarily unavailable. Retry shortly.' },
      { status: 503 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: 'upstream_error', message: `FX reference provider returned HTTP ${response.status}.` },
      { status: 502 },
    );
  }

  let payload: FrankfurterRow[];
  try {
    payload = (await response.json()) as FrankfurterRow[];
  } catch {
    return NextResponse.json(
      { error: 'invalid_upstream_response', message: 'FX reference provider returned unreadable data.' },
      { status: 502 },
    );
  }

  if (!Array.isArray(payload)) {
    return NextResponse.json(
      { error: 'invalid_upstream_response', message: 'FX reference provider returned incomplete data.' },
      { status: 502 },
    );
  }

  const rates: Record<string, number> = {};
  const dates: string[] = [];
  for (const row of payload) {
    if (!row || row.base !== base || typeof row.quote !== 'string' || !uniqueSymbols.includes(row.quote)) continue;
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0) continue;
    rates[row.quote] = row.rate;
    dates.push(row.date);
  }

  if (payload.length > 0 && Object.keys(rates).length === 0) {
    return NextResponse.json(
      { error: 'invalid_upstream_response', message: 'FX reference provider returned no valid rates.' },
      { status: 502 },
    );
  }

  const observationDate = dates.sort().at(-1);

  return NextResponse.json(
    {
      source: 'Frankfurter daily reference rates',
      kind: 'daily_reference_not_intraday',
      base,
      date: observationDate || null,
      rates,
      missing: uniqueSymbols.filter((code) => rates[code] === undefined),
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    },
  );
}
