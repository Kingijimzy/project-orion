import { NextResponse } from 'next/server';
import { validateConversationTitle } from '@/lib/ai/chat-validation';
import { readLimitedJson } from '@/lib/api/read-json';
import { createProvider, ProviderError } from '@/lib/ai/provider';
import { createSupabaseServerClient, supabaseConfiguration } from '@/lib/supabase/server';
import { validatePrivateChartImagePath } from '@/lib/supabase/private-chart-image';

export const runtime = 'nodejs';
const unavailable = () => NextResponse.json({ error: 'supabase_not_configured', message: 'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then apply the database migration.' }, { status: 503 });
const signInRequired = () => NextResponse.json({ error: 'authentication_required', message: 'Sign in to save and load private conversations.' }, { status: 401 });

async function authenticatedClient() {
  if (!supabaseConfiguration()) return { error: unavailable() } as const;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: unavailable() } as const;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: signInRequired() } as const;
  return { supabase, user } as const;
}

async function validateProviderModel(providerValue: unknown, modelValue: unknown) {
  const provider = providerValue === undefined ? 'openrouter' : providerValue;
  const model = modelValue === undefined ? (provider === 'openrouter' ? process.env.OPENROUTER_MODEL : process.env.GEMINI_MODEL) : modelValue;
  if ((provider !== 'gemini' && provider !== 'openrouter') || typeof model !== 'string' || !model) {
    return { error: NextResponse.json({ error: 'invalid_model', message: 'Select a configured provider and model.' }, { status: 400 }) } as const;
  }
  try {
    await createProvider(provider, model);
    return { provider, model } as const;
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : new ProviderError('Selected model is not configured.');
    return { error: NextResponse.json({ error: providerError.code, message: providerError.message }, { status: 503 }) } as const;
  }
}

export async function GET(request: Request) {
  const auth = await authenticatedClient();
  if ('error' in auth) return auth.error;
  const url = new URL(request.url);
  const conversationId = url.searchParams.get('id');
  if (conversationId) {
    const { data, error } = await auth.supabase.from('conversations').select('id,title,provider,model_id,created_at,updated_at,messages(id,role,content,metadata,provider,model_id,assistant_mode,created_at)').eq('id', conversationId).eq('user_id', auth.user.id).single();
    if (error || !data) return NextResponse.json({ error: 'conversation_not_found', message: 'Conversation not found.' }, { status: 404 });
    const messages = [...(data.messages || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return NextResponse.json({ conversation: { ...data, messages } });
  }
  const { data, error } = await auth.supabase.from('conversations').select('id,title,provider,model_id,created_at,updated_at').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'history_load_failed', message: 'Could not load conversations. Try again.' }, { status: 500 });
  return NextResponse.json({ conversations: data || [] });
}

export async function POST(request: Request) {
  const auth = await authenticatedClient();
  if ('error' in auth) return auth.error;
  const parsedBody = await readLimitedJson(request);
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.reason === 'too_large' ? 'request_too_large' : 'invalid_request', message: parsedBody.reason === 'too_large' ? 'Request body is too large.' : 'Send a valid JSON request.' }, { status: parsedBody.reason === 'too_large' ? 413 : 400 });
  const body = parsedBody.value && typeof parsedBody.value === 'object' ? parsedBody.value as Record<string, unknown> : {};
  const title = validateConversationTitle(body.title);
  if (!title) return NextResponse.json({ error: 'invalid_title', message: 'Conversation title must be between 1 and 120 characters.' }, { status: 400 });
  const selection = await validateProviderModel(body.provider, body.model);
  if ('error' in selection) return selection.error;
  const { data, error } = await auth.supabase.from('conversations').insert({ user_id: auth.user.id, title, provider: selection.provider, model_id: selection.model }).select('id,title,provider,model_id,created_at,updated_at').single();
  if (error || !data) return NextResponse.json({ error: 'conversation_create_failed', message: 'Could not create the conversation. Try again.' }, { status: 500 });
  return NextResponse.json({ conversation: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticatedClient();
  if ('error' in auth) return auth.error;
  const parsedBody = await readLimitedJson(request);
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.reason === 'too_large' ? 'request_too_large' : 'invalid_request', message: parsedBody.reason === 'too_large' ? 'Request body is too large.' : 'Send a valid JSON request.' }, { status: parsedBody.reason === 'too_large' ? 413 : 400 });
  const record = parsedBody.value && typeof parsedBody.value === 'object' ? parsedBody.value as Record<string, unknown> : {};
  if (typeof record.id !== 'string') return NextResponse.json({ error: 'invalid_request', message: 'Conversation ID is required.' }, { status: 400 });
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (record.title !== undefined) {
    const title = validateConversationTitle(record.title);
    if (!title) return NextResponse.json({ error: 'invalid_title', message: 'Conversation title must be between 1 and 120 characters.' }, { status: 400 });
    updates.title = title;
  }
  if (record.provider !== undefined || record.model !== undefined) {
    const selection = await validateProviderModel(record.provider, record.model);
    if ('error' in selection) return selection.error;
    updates.provider = selection.provider; updates.model_id = selection.model;
  }
  if (Object.keys(updates).length === 1) return NextResponse.json({ error: 'invalid_request', message: 'Provide a title or provider/model selection to update.' }, { status: 400 });
  const { data, error } = await auth.supabase.from('conversations').update(updates).eq('id', record.id).eq('user_id', auth.user.id).select('id,title,provider,model_id,created_at,updated_at').single();
  if (error || !data) return NextResponse.json({ error: 'conversation_not_found', message: 'Conversation not found.' }, { status: 404 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(request: Request) {
  const auth = await authenticatedClient();
  if ('error' in auth) return auth.error;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'invalid_request', message: 'Conversation ID is required.' }, { status: 400 });
  const { data: messages } = await auth.supabase.from('messages').select('metadata').eq('conversation_id', id).eq('user_id', auth.user.id);
  const imagePaths = (messages || []).map((message) => validatePrivateChartImagePath((message.metadata as Record<string, unknown> | null)?.chartImagePath, auth.user.id, id)).filter((path): path is string => Boolean(path));
  const { data, error } = await auth.supabase.from('conversations').delete().eq('id', id).eq('user_id', auth.user.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'conversation_delete_failed', message: 'Could not delete this conversation.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'conversation_not_found', message: 'Conversation not found.' }, { status: 404 });
  if (imagePaths.length) {
    const { error: cleanupError } = await auth.supabase.storage.from('orion-chart-images').remove([...new Set(imagePaths)]);
    return NextResponse.json({ ok: true, imageCleanup: cleanupError ? 'pending' : 'complete' });
  }
  return NextResponse.json({ ok: true, imageCleanup: 'not-needed' });
}
