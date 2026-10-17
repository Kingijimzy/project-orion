import { NextResponse } from 'next/server';
import { loadOfficialNews } from '@/lib/news/official-feeds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { items, unavailableSources } = await loadOfficialNews();
  if (items.length === 0) return NextResponse.json({ items, unavailableSources, message: 'Official news feeds are currently unavailable. Retry shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ items, unavailableSources, message: null }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' } });
}
