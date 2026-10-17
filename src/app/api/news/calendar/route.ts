import { NextResponse } from 'next/server';
import { loadOfficialEconomicCalendar } from '@/lib/news/economic-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { events, unavailableSources } = await loadOfficialEconomicCalendar();
  if (!events.length && unavailableSources.length === 2) {
    return NextResponse.json({ events, unavailableSources, message: 'Official economic calendars are temporarily unavailable. Retry shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ events, unavailableSources, message: null }, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=900' } });
}
