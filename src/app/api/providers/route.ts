import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/ai/provider';
import { checkOpenRouterStatus } from '@/lib/ai/openrouter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const configured = providerStatus();
  const [openrouter] = await Promise.all([checkOpenRouterStatus()]);
  return NextResponse.json({
    gemini: configured.gemini,
    openrouter,
    openAICompatible: { configured: false, message: 'Not implemented in this phase.' },
    deepSeekCompatible: { configured: false, message: 'Not implemented in this phase.' },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
