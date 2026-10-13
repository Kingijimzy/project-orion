import { NextResponse } from 'next/server';
import { BybitPublicMarketData, isBybitCategory, MarketDataError } from '@/lib/market/bybit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const marketData = new BybitPublicMarketData();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get('category') || 'linear';
  const query = params.get('q') || '';
  if (!isBybitCategory(category) || query.length > 40) return NextResponse.json({ error: 'invalid_request', message: 'Choose a valid market and search term.' }, { status: 400 });
  try { return NextResponse.json({ category, symbols: await marketData.searchSymbols(category, query) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const failure = error instanceof MarketDataError ? error : new MarketDataError('The symbol search failed.');
    return NextResponse.json({ error: failure.code, message: failure.message }, { status: failure.status });
  }
}
