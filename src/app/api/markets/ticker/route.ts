import { NextResponse } from 'next/server';
import { BybitPublicMarketData, isBybitCategory, MarketDataError } from '@/lib/market/bybit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const marketData = new BybitPublicMarketData();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get('category') || 'linear';
  const symbol = (params.get('symbol') || '').toUpperCase();
  if (!isBybitCategory(category) || !/^[A-Z0-9]{2,30}$/.test(symbol)) return NextResponse.json({ error: 'invalid_request', message: 'Choose a valid category and symbol.' }, { status: 400 });
  try { return NextResponse.json(await marketData.getTicker(category, symbol), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const failure = error instanceof MarketDataError ? error : new MarketDataError('The ticker request failed.');
    return NextResponse.json({ error: failure.code, message: failure.message }, { status: failure.status });
  }
}
