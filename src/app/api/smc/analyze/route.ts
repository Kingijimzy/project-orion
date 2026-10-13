import { NextResponse } from 'next/server';
import { readLimitedJson } from '@/lib/api/read-json';
import { BybitPublicMarketData, isBybitCategory, MarketDataError } from '@/lib/market/bybit';
import { analyzeFromMarketData } from '@/lib/smc/market-analysis';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_STRATEGY_PROFILE, settingsToEngineOptions, validateStrategySettings } from '@/lib/smc/strategy-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const marketData = new BybitPublicMarketData();

export async function POST(request: Request) {
  const parsed = await readLimitedJson(request);
  if (!parsed.ok) return NextResponse.json({ error: 'invalid_request', message: 'Send a valid JSON analysis request.' }, { status: parsed.reason === 'too_large' ? 413 : 400 });
  const body = parsed.value && typeof parsed.value === 'object' ? parsed.value as Record<string, unknown> : {};
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  const category = body.category === undefined ? 'linear' : body.category;
  const timeframe = body.timeframe === undefined ? '60' : body.timeframe;
  if (!/^[A-Z0-9]{2,30}$/.test(symbol) || typeof category !== 'string' || !isBybitCategory(category) || (timeframe !== '30' && timeframe !== '60')) {
    return NextResponse.json({ error: 'invalid_request', message: 'Choose a valid Bybit category, symbol, and 30m or 1H confirmation timeframe.' }, { status: 400 });
  }
  try {
    const client = await createSupabaseServerClient();
    const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
    let profile = DEFAULT_STRATEGY_PROFILE;
    if (client && user) {
      const query = client.from('strategy_profiles').select('*').eq('user_id', user.id);
      const { data: rows } = typeof body.profileId === 'string' ? await query.eq('id', body.profileId).limit(1) : await query.eq('is_selected', true).limit(1);
      const row = rows?.[0];
      if (row) { const validation = validateStrategySettings(row.settings); if (!validation.ok) return NextResponse.json({ error:'invalid_profile', message:'Selected profile settings are invalid; edit or select a valid profile.' }, { status:422 }); profile = { id:row.id, name:row.name, version:row.version, settings:validation.settings }; }
    }
    const result = await analyzeFromMarketData(marketData, { symbol, category, timeframe }, settingsToEngineOptions(profile.settings));
    let savedAnalysisId: string | null = null;
    let historyWarning: string | null = null;
    if (client && user) {
      const lowerQuality=result.analysis.structure.dataQuality;
      const dataQuality={assessment:result.analysis.dataQuality,timeframes:{daily:result.analysis.higherTimeframes.daily.dataQuality,fourHour:result.analysis.higherTimeframes.fourHour.dataQuality,lower:lowerQuality},candleCounts:Object.fromEntries(Object.entries(result.candles).map(([key,series])=>[key,series.length])),lastCandles:{daily:result.analysis.higherTimeframes.daily.lastCandleTimestamp,fourHour:result.analysis.higherTimeframes.fourHour.lastCandleTimestamp,lower:lowerQuality.lastCandleTimestamp}};
      const { data, error } = await client.from('smc_analyses').insert({ user_id:user.id, symbol, market_category:category, timeframe, analysis_timestamp:new Date(result.analysis.analysisTimestamp).toISOString(), last_market_update:result.lastSuccessfulUpdate, candle_snapshot:result.candles, data_quality:dataQuality, strategy_profile_id:profile.id===DEFAULT_STRATEGY_PROFILE.id?null:profile.id, strategy_name:profile.name, strategy_version:profile.version, strategy_settings:profile.settings, engine_version:'orion-smc-1.1.0', findings:result.analysis }).select('id').single();
      if (error) historyWarning='Analysis ran, but Supabase history could not save it. Check the latest migration and database configuration.'; else savedAnalysisId=data.id;
    }
    return NextResponse.json({ ...result, strategyProfile:profile, engineVersion:'orion-smc-1.1.0', savedAnalysisId, historyWarning, feed: { category, source: result.source, lastSuccessfulUpdate: result.lastSuccessfulUpdate } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = error instanceof MarketDataError ? error : new MarketDataError('Market analysis failed while loading verified candles.');
    return NextResponse.json({ error: failure.code, message: failure.message }, { status: failure.status });
  }
}
