import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Frankfurter publishes daily reference exchange rates, not executable/intraday FX quotes.
// Keep this endpoint explicit about the source and observation date so the UI cannot
// accidentally present these values as live broker prices.
const BASE_URL = 'https://api.frankfurter.dev/v1/latest';
const CURRENCY_CODE = /^[A-Z]{3}$/;
const DEFAULT_BASE = 'USD';
const DEFAULT_SYMBOLS = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

type FrankfurterPayload = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

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
  url.searchParams.set('symbols', uniqueSymbols.join(','));

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

  let payload: FrankfurterPayload;
  try {
    payload = (await response.json()) as FrankfurterPayload;
  } catch {
    return NextResponse.json(
      { error: 'invalid_upstream_response', message: 'FX reference provider returned unreadable data.' },
      { status: 502 },
    );
  }

  if (
    payload.base !== base ||
    typeof payload.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
    !payload.rates ||
    typeof payload.rates !== 'object'
  ) {
    return NextResponse.json(
      { error: 'invalid_upstream_response', message: 'FX reference provider returned incomplete data.' },
      { status: 502 },
    );
  }

  const rates: Record<string, number> = {};
  for (const code of uniqueSymbols) {
    const rate = payload.rates[code];
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      rates[code] = rate;
    }
  }

  return NextResponse.json(
    {
      source: 'Frankfurter daily reference rates',
      kind: 'daily_reference_not_intraday',
      base,
      date: payload.date,
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
