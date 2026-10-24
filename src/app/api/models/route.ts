import { NextResponse } from 'next/server';
import { checkGeminiStatus } from '@/lib/ai/provider';
import { getOpenRouterModels } from '@/lib/ai/openrouter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type ModelOption = { id: string; name: string; free: boolean | null; contextLength: number | null; inputModalities?: string[] };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') || 'openrouter';
  if (provider === 'gemini') {
    const status = await checkGeminiStatus();
    const models: ModelOption[] = status.model ? [{ id: status.model, name: status.model, free: status.paidUseEnabled ? null : true, contextLength: null }] : [];
    return NextResponse.json({ provider, configured: status.configured, message: status.message, models, freeFilterAvailable: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (provider !== 'openrouter') return NextResponse.json({ error: 'provider_not_configured', message: 'This provider is not implemented in this phase.' }, { status: 400 });
  try {
    const all = await getOpenRouterModels();
    const paidAllowed = process.env.OPENROUTER_ALLOW_PAID_MODEL === 'true';
    const allowed = all.filter((model) => model.free === true || paidAllowed);
    const freeFilterAvailable = all.some((model) => model.free !== null);
    const freeOnly = url.searchParams.get('freeOnly') === 'true';
    const query = url.searchParams.get('q')?.trim().toLocaleLowerCase() || '';
    const filtered = allowed.filter((model) => (!freeOnly || model.free === true) && (!query || model.id.toLocaleLowerCase().includes(query) || model.name.toLocaleLowerCase().includes(query)));
    const models: ModelOption[] = filtered.slice(0, 500).map(({ id, name, free, contextLength, inputModalities }) => ({ id, name, free, contextLength, inputModalities }));
    return NextResponse.json({ provider, configured: models.length > 0 || (allowed.length > 0 && freeOnly), paidUseEnabled: paidAllowed, selectedModel: process.env.OPENROUTER_MODEL?.trim() || null, models, freeFilterAvailable, message: 'OpenRouter catalogue loaded.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load OpenRouter models.';
    return NextResponse.json({ provider, configured: false, models: [], freeFilterAvailable: false, message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
