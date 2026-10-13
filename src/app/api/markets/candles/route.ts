import { NextResponse } from 'next/server';
import { BybitPublicMarketData, isBybitCategory, isBybitInterval, MarketDataError } from '@/lib/market/bybit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const marketData = new BybitPublicMarketData();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get('category') || 'linear';
  const symbol = (params.get('symbol') || '').toUpperCase();
  const interval = params.get('interval') || '60';
  const limit = Number(params.get('limit') || 100);
  if (!isBybitCategory(category) || !isBybitInterval(interval) || !/^[A-Z0-9]{2,30}$/.test(symbol) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: 'invalid_request', message: 'Choose a valid category, symbol, timeframe, and limit.' }, { status: 400 });
  }
  try { return NextResponse.json(await marketData.getCandles(category, symbol, interval, limit), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const failure = error instanceof MarketDataError ? error : new MarketDataError('The market-data request failed.');
    return NextResponse.json({ error: failure.code, message: failure.message }, { status: failure.status });
  }
}
