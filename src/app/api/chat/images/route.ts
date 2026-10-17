import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { privateChartImageContentType, validatePrivateChartImagePath } from '@/lib/supabase/private-chart-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BUCKET = 'orion-chart-images';

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Sign in to view this private chart image.' }, { status: 401 });
  const path = validatePrivateChartImagePath(new URL(request.url).searchParams.get('path'), user.id);
  const contentType = path ? privateChartImageContentType(path) : null;
  if (!path || !contentType) return NextResponse.json({ message: 'Private chart image not found.' }, { status: 404 });
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return NextResponse.json({ message: 'Private chart image not found.' }, { status: 404 });
  return new Response(data, { headers: { 'Content-Type': contentType, 'Content-Length': String(data.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
