import { NextResponse } from 'next/server';
import { readLimitedJson } from '@/lib/api/read-json';
import { BybitPublicMarketData, isBybitCategory, MarketDataError, type CandleResult } from '@/lib/market/bybit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_STRATEGY_PROFILE, settingsToEngineOptions, validateStrategySettings, type StrategyProfile } from '@/lib/smc/strategy-profile';
import { runBacktest, type BacktestReport } from '@/lib/smc/backtest';
import type { OHLCV } from '@/lib/smc/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const marketData = new BybitPublicMarketData();

type CacheItem = { expires: number; report: BacktestReport; profile: StrategyProfile; lastSuccessfulUpdate: string };
const cache = new Map<string, CacheItem>();
const CACHE_MS = 60_000;

const toOhlcv = (candles: CandleResult['candles']): OHLCV[] => candles.map((candle) => ({ timestamp: candle.startTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, closed: candle.closed }));

export async function POST(request: Request) {
  const parsed = await readLimitedJson(request);
  if (!parsed.ok) return NextResponse.json({ error: 'invalid_request', message: 'Send a valid JSON backtest request.' }, { status: parsed.reason === 'too_large' ? 413 : 400 });
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
      if (row) {
        const validation = validateStrategySettings(row.settings);
        if (!validation.ok) return NextResponse.json({ error: 'invalid_profile', message: 'Selected profile settings are invalid; edit or select a valid profile.' }, { status: 422 });
        profile = { id: row.id, name: row.name, version: row.version, settings: validation.settings };
      }
    }

    const cacheKey = `${category}:${symbol}:${timeframe}:${profile.id}:${profile.version}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json({ ...cached.report, strategyProfile: cached.profile, engineVersion: 'orion-smc-backtest-1.0.0', feed: { category, source: cached.report.source, lastSuccessfulUpdate: cached.lastSuccessfulUpdate }, cached: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [daily, fourHour, oneHour, thirtyMinute] = await Promise.all([
      marketData.getCandles(category, symbol, 'D', 400),
      marketData.getCandles(category, symbol, '240', 400),
      marketData.getCandles(category, symbol, '60', timeframe === '60' ? 800 : 400),
      marketData.getCandles(category, symbol, '30', timeframe === '30' ? 800 : 400),
    ]);
    const report = runBacktest({
      symbol, timeframe,
      candles: { daily: toOhlcv(daily.candles), fourHour: toOhlcv(fourHour.candles), oneHour: toOhlcv(oneHour.candles), thirtyMinute: toOhlcv(thirtyMinute.candles) },
      options: settingsToEngineOptions(profile.settings),
    });
    const lastSuccessfulUpdate = [daily, fourHour, oneHour, thirtyMinute].map((result) => result.lastUpdated).sort().at(-1) || new Date().toISOString();
    cache.set(cacheKey, { report, profile, lastSuccessfulUpdate, expires: Date.now() + CACHE_MS });
    return NextResponse.json({ ...report, strategyProfile: profile, engineVersion: 'orion-smc-backtest-1.0.0', feed: { category, source: report.source, lastSuccessfulUpdate }, cached: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = error instanceof MarketDataError ? error : new MarketDataError('Backtest failed while loading verified candles.');
    return NextResponse.json({ error: failure.code, message: failure.message }, { status: failure.status });
  }
}
