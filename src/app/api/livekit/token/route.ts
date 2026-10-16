import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { createSupabaseServerClient, supabaseConfiguration } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const serverUrl = process.env.LIVEKIT_URL?.trim();

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json({
      error: 'livekit_not_configured',
      message: 'LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.',
    }, { status: 503 });
  }
  if (!supabaseConfiguration()) {
    return NextResponse.json({ error: 'supabase_not_configured', message: 'Sign-in is unavailable until Supabase is configured.' }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'supabase_not_configured', message: 'Supabase is not configured.' }, { status: 503 });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'authentication_required', message: 'Sign in to start a private Orion voice session.' }, { status: 401 });

  const roomName = `orion-${user.id}-${crypto.randomUUID()}`;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: 'Orion user',
    ttl: '10m',
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({
    serverUrl,
    roomName,
    token: await token.toJwt(),
    agentName: process.env.LIVEKIT_AGENT_NAME?.trim() || 'orion-voice-agent',
    expiresInSeconds: 600,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
