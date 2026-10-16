import { NextResponse } from 'next/server';
import { validateChatRequest } from '@/lib/ai/chat-validation';
import { readLimitedJson } from '@/lib/api/read-json';
import { createProvider, ProviderError, type ProviderMessage } from '@/lib/ai/provider';
import { createSupabaseServerClient, supabaseConfiguration } from '@/lib/supabase/server';
import { BybitPublicMarketData, MarketDataError } from '@/lib/market/bybit';
import { analyzeFromMarketData } from '@/lib/smc/market-analysis';
import { DEFAULT_STRATEGY_PROFILE, settingsToEngineOptions } from '@/lib/smc/strategy-profile';

export const runtime = 'nodejs';
export const maxDuration = 60;
const marketData = new BybitPublicMarketData();

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function smcProviderContext(result: NonNullable<Awaited<ReturnType<typeof analyzeFromMarketData>>>) {
  const analysis = result.analysis;
  const reduceTimeframe = (item: typeof analysis.structure) => ({
    timeframe: item.timeframe, structure: item.structure, lastCandleTimestamp: item.lastCandleTimestamp, lastCandleClosed: item.lastCandleClosed, dataQuality: item.dataQuality,
    swings: item.swings.slice(-12), structureBreaks: item.structureBreaks.slice(-10), liquidityPools: item.liquidityPools.slice(-10), sweeps: item.sweeps.slice(-8), fvgs: item.fvgs.slice(-12), orderBlocks: item.orderBlocks.slice(-12),
  });
  return {
    source: result.source, lastSuccessfulUpdate: result.lastSuccessfulUpdate,
    analysis: {
      symbol: analysis.symbol, timeframe: analysis.timeframe, analysisTimestamp: analysis.analysisTimestamp, state: analysis.state,
      higherTimeframeBias: analysis.higherTimeframeBias, dailyBias: analysis.dailyBias, fourHourBias: analysis.fourHourBias, lowerTimeframeStructure: analysis.lowerTimeframeStructure,
      higherTimeframes: { daily: reduceTimeframe(analysis.higherTimeframes.daily), fourHour: reduceTimeframe(analysis.higherTimeframes.fourHour) },
      structure: reduceTimeframe(analysis.structure), alignedCandles: analysis.alignedCandles.slice(-8), relevantLiquidity: analysis.relevantLiquidity,
      fvgs: analysis.fvgs.slice(-12), orderBlocks: analysis.orderBlocks.slice(-12), supportingEvidence: analysis.supportingEvidence,
      conflictingEvidence: analysis.conflictingEvidence, requiredConfirmation: analysis.requiredConfirmation,
      invalidationConditions: analysis.invalidationConditions, dataQuality: analysis.dataQuality, qualificationRule: analysis.qualificationRule,
    },
  };
}

export async function POST(request: Request) {
  const imageRequest = request.headers.get('x-orion-image') === 'true';
  const parsedBody = await readLimitedJson(request, imageRequest ? 4.5 * 1024 * 1024 : 32 * 1024);
  if (!parsedBody.ok) return parsedBody.reason === 'too_large'
    ? jsonError(413, 'request_too_large', imageRequest ? 'The chart image request is too large. Images must be 3 MB or smaller.' : 'This request is too large. Keep messages under 12,000 characters.')
    : jsonError(400, 'invalid_request', 'Send a valid JSON request.');
  const body = parsedBody.value;
  const input = validateChatRequest(body);
  if (!input) return jsonError(400, 'invalid_request', 'A conversation ID, non-empty message (up to 12,000 characters), supported provider/model, and valid assistant mode are required. Attach only a valid PNG, JPEG, or WebP image up to 3 MB, and use OpenRouter.');
  if (!supabaseConfiguration()) return jsonError(503, 'supabase_not_configured', 'Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY and apply the Supabase migration before using private chat.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) return jsonError(503, 'supabase_not_configured', 'Supabase is not configured.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError(401, 'authentication_required', 'Sign in before sending a message.');

  let provider;
  try { provider = await createProvider(input.provider, input.model, process.env, { requireImageInput: Boolean(input.image) }); }
  catch (error) {
    if (error instanceof ProviderError) return jsonError(503, error.code, error.message);
    return jsonError(503, 'provider_not_configured', 'The selected provider is not configured.');
  }

  const { data: conversation, error: conversationError } = await supabase.from('conversations').select('id').eq('id', input.conversationId).eq('user_id', user.id).single();
  if (conversationError || !conversation) return jsonError(404, 'conversation_not_found', 'Conversation not found.');
  let smcResult: Awaited<ReturnType<typeof analyzeFromMarketData>> | null = null;
  let savedSmcAnalysisId: string | null = null;
  if (input.smcRequest) {
    try { smcResult = await analyzeFromMarketData(marketData, input.smcRequest, settingsToEngineOptions(DEFAULT_STRATEGY_PROFILE.settings)); }
    catch (error) {
      const failure = error instanceof MarketDataError ? error : new MarketDataError('Could not run the SMC tool with verified market data.');
      return jsonError(failure.status, failure.code, failure.message);
    }
    const quality={assessment:smcResult.analysis.dataQuality,timeframes:{daily:smcResult.analysis.higherTimeframes.daily.dataQuality,fourHour:smcResult.analysis.higherTimeframes.fourHour.dataQuality,lower:smcResult.analysis.structure.dataQuality},candleCounts:Object.fromEntries(Object.entries(smcResult.candles).map(([key,series])=>[key,series.length]))};
    const { data: savedAnalysis } = await supabase.from('smc_analyses').insert({ user_id:user.id, symbol:input.smcRequest.symbol, market_category:input.smcRequest.category, timeframe:input.smcRequest.timeframe, analysis_timestamp:new Date(smcResult.analysis.analysisTimestamp).toISOString(), last_market_update:smcResult.lastSuccessfulUpdate, candle_snapshot:smcResult.candles, data_quality:quality, strategy_profile_id:null, strategy_name:DEFAULT_STRATEGY_PROFILE.name, strategy_version:DEFAULT_STRATEGY_PROFILE.version, strategy_settings:DEFAULT_STRATEGY_PROFILE.settings, engine_version:'orion-smc-1.1.0', findings:smcResult.analysis }).select('id').single();
    if (savedAnalysis) savedSmcAnalysisId=savedAnalysis.id;
  }
  const { data: previousMessages, error: historyError } = await supabase.from('messages').select('role,content').eq('conversation_id', input.conversationId).eq('user_id', user.id).order('created_at', { ascending: true }).limit(80);
  if (historyError) return jsonError(500, 'history_load_failed', 'Could not load conversation history. Try again.');

  if (input.retry) {
    const last = previousMessages?.at(-1);
    if (!last || last.role !== 'user' || last.content !== input.message) return jsonError(409, 'retry_not_available', 'There is no matching user message to retry.');
  } else {
    const { error: saveUserError } = await supabase.from('messages').insert({ conversation_id: input.conversationId, user_id: user.id, role: 'user', content: input.message, provider: input.provider, model_id: input.model, assistant_mode: input.mode });
    if (saveUserError) return jsonError(500, 'message_save_failed', 'Could not save your message. Try again.');
  }
  await supabase.from('conversations').update({ provider: input.provider, model_id: input.model, updated_at: new Date().toISOString() }).eq('id', input.conversationId).eq('user_id', user.id);
  const history: ProviderMessage[] = input.retry
    ? (previousMessages || []).map((message) => ({ role: message.role as ProviderMessage['role'], content: message.content }))
    : [...(previousMessages || []).map((message) => ({ role: message.role as ProviderMessage['role'], content: message.content })), { role: 'user', content: input.message }];
  if (smcResult) {
    const lastUserIndex = history.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex >= 0) history[lastUserIndex] = { ...history[lastUserIndex], content: `${history[lastUserIndex].content}\n\n[Verified deterministic SMC tool result from Bybit V5. Treat every calculated price level and state below as fixed engine output: do not alter, recalculate, or replace levels. Explain the rule evidence and call out missing confirmations. If data quality is invalid or stale, say no reliable setup conclusion can be made.]\n${JSON.stringify(smcProviderContext(smcResult))}` };
  }
  if (input.image) {
    const lastUserIndex = history.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex >= 0) {
      const last = history[lastUserIndex];
      const text = typeof last.content === 'string' ? last.content : last.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      history[lastUserIndex] = {
        ...last,
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}` } },
        ],
      };
    }
  }
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  request.signal.addEventListener('abort', abortFromRequest, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(new Error('timeout')); }, 55_000);
  const encoder = new TextEncoder();
  let stream: AsyncIterable<string>;
  try { stream = provider.stream(history, input.mode, controller.signal); }
  catch (error) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortFromRequest);
    const providerError = error instanceof ProviderError ? error : new ProviderError('The provider could not start this response.');
    return jsonError(providerError.status === 429 ? 429 : 502, providerError.code, providerError.message);
  }

  const responseBody = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let assistantText = '';
      try {
        if (smcResult) streamController.enqueue(encoder.encode(`event: smc-result\ndata: ${JSON.stringify({ source: smcResult.source, lastSuccessfulUpdate: smcResult.lastSuccessfulUpdate, analysis: smcResult.analysis, candles: smcResult.candles })}\n\n`));
        for await (const chunk of stream) {
          if (controller.signal.aborted) break;
          assistantText += chunk;
          streamController.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`));
        }
        if (!controller.signal.aborted && assistantText.trim()) {
          const { error } = await supabase.from('messages').insert({ conversation_id: input.conversationId, user_id: user.id, role: 'assistant', content: assistantText, provider: input.provider, model_id: input.model, assistant_mode: input.mode });
          if (error) throw new Error('message_persist_failed');
          if(savedSmcAnalysisId) await supabase.from('smc_analysis_explanations').insert({analysis_id:savedSmcAnalysisId,user_id:user.id,provider:input.provider,model_id:input.model,content:assistantText});
          await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', input.conversationId).eq('user_id', user.id);
          streamController.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        } else if (!controller.signal.aborted) {
          throw new ProviderError('The selected provider returned an empty response. Try again.', undefined, 'empty_response');
        }
      } catch (error) {
        if (!controller.signal.aborted || timedOut) {
          const providerError = timedOut
            ? new ProviderError('The selected provider took too long to respond. Your message is saved; retry to continue.', undefined, 'timeout')
            : error instanceof ProviderError ? error : new ProviderError('The response could not be saved. Your message is preserved; retry to continue.', undefined, 'response_failed');
          streamController.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: providerError.code, message: providerError.message })}\n\n`));
        }
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortFromRequest);
        try { streamController.close(); } catch { /* client may have cancelled */ }
      }
    },
    cancel() { controller.abort(); clearTimeout(timeout); request.signal.removeEventListener('abort', abortFromRequest); },
  });

  return new Response(responseBody, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
