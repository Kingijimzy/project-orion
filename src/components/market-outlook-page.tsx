'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, Search } from 'lucide-react';
import type { BybitCategory } from '@/lib/market/bybit';
import type { OHLCV, SMCAssessment } from '@/lib/smc/engine';
import { buildScenarios } from '@/lib/smc/scenarios';
import type { OfficialNewsItem } from '@/lib/news/official-feeds';

type OutlookCandles = { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] };
type OutlookResult = { analysis: SMCAssessment; source: string; lastSuccessfulUpdate: string; candles?: OutlookCandles };
function currentPrice(result: OutlookResult | null): number | null {
  if (!result?.candles) return null;
  const series = result.analysis.timeframe === '30' ? result.candles.thirtyMinute : result.candles.oneHour;
  const closed = series.filter((candle) => candle.closed !== false);
  const match = closed.find((candle) => candle.timestamp === result.analysis.structure.lastCandleTimestamp) ?? closed.at(-1);
  return match?.close ?? null;
}
type BacktestResult = {
  evaluationPoints: number;
  byState: Record<string, number>;
  totals: { signals: number; actionable: number; target: number; stop: number; expired: number; open: number; resolved: number; winRate: number | null; averageR: number | null; expectancyR: number | null };
  engineInput: { riskReward: number; forwardBars: number; stride: number; maxEvaluations: number };
  caveats: string[];
  strategyProfile?: { name: string; version: number };
  lastEvaluationTimestamp?: number | null;
};

export function MarketOutlookPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [category, setCategory] = useState<BybitCategory>('linear');
  const [timeframe, setTimeframe] = useState<'30' | '60'>('60');
  const [result, setResult] = useState<OutlookResult | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestWarning, setBacktestWarning] = useState('');
  const [news, setNews] = useState<OfficialNewsItem[]>([]);
  const [newsWarning, setNewsWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const scenarios = useMemo(() => {
    if (!result) return null;
    return buildScenarios({
      analysis: result.analysis,
      lastPrice: currentPrice(result),
      historicalContext: backtest ? { resolved: backtest.totals.resolved, winRate: backtest.totals.winRate, averageR: backtest.totals.averageR, riskReward: backtest.engineInput.riskReward } : null,
    });
  }, [result, backtest]);

  async function analyze(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(''); setNewsWarning(''); setBacktestWarning(''); setBacktest(null);
    try {
      const marketResponse = await fetch('/api/smc/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, category, timeframe }) });
      const market = await marketResponse.json() as OutlookResult & { message?: string };
      if (!marketResponse.ok) throw new Error(market.message || 'Bybit market analysis is unavailable.');
      setResult(market);
      try {
        const backtestResponse = await fetch('/api/smc/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, category, timeframe }) });
        const baseRate = await backtestResponse.json() as BacktestResult & { message?: string };
        if (backtestResponse.ok) setBacktest(baseRate);
        else setBacktestWarning(baseRate.message || 'Historical base rate is unavailable.');
      } catch { setBacktestWarning('Historical base rate could not be reached; the current assessment is shown separately.'); }
      try {
        const newsResponse = await fetch('/api/news', { cache: 'no-store' });
        const feed = await newsResponse.json() as { items?: OfficialNewsItem[]; message?: string };
        if (newsResponse.ok) setNews((feed.items || []).slice(0, 8));
        else { setNews([]); setNewsWarning(feed.message || 'Official news feeds are unavailable.'); }
      } catch { setNews([]); setNewsWarning('Official news feeds could not be reached; the technical assessment is shown separately.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not build the evidence summary.'); }
    finally { setBusy(false); }
  }

  const assessment = result?.analysis;
  return <div className="outlook-page">
    <div className="market-heading"><div><div className="eyebrow"><span className="green-pip"/> EVIDENCE SUMMARY · NO PREDICTION</div><h1>Market outlook</h1><p>Deterministic Bybit SMC findings with separate official U.S. release headlines.</p></div></div>
    <form className="smc-query outlook-query" onSubmit={analyze}><label>CRYPTO SYMBOL<input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} required maxLength={30}/></label><label>BYBIT MARKET<select value={category} onChange={(event) => setCategory(event.target.value as BybitCategory)}><option value="linear">Linear contracts</option><option value="spot">Spot</option><option value="inverse">Inverse contracts</option></select></label><label>ENTRY TIMEFRAME<select value={timeframe} onChange={(event) => setTimeframe(event.target.value as '30' | '60')}><option value="60">1H</option><option value="30">30M</option></select></label><button className="market-refresh" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={14} className="spin"/> Building…</> : <><Search size={14}/> Build evidence</>}</button></form>
    <p className="smc-timeframe-note">Analysis combines Daily and 4H context with closed 1H/30M candles. News is shown as sourced macro context and is not automatically scored as bullish or bearish for this instrument.</p>
    {error && <div className="inline-error market-error" role="alert">{error} <button onClick={() => void analyze()}>Retry</button></div>}
    {!assessment && !busy && !error && <div className="smc-empty"><b>Build a current evidence summary</b><span>Orion will show a directional state only when the deterministic rules and data quality support one.</span></div>}
    {busy && <div className="news-empty"><LoaderCircle size={18} className="spin"/> Fetching verified market and source data…</div>}
    {assessment && <>
      <section className="outlook-state"><div><span className="eyebrow">DETERMINISTIC STATE · {assessment.symbol} · {assessment.timeframe === '30' ? '30M' : '1H'}</span><h2>{assessment.state}</h2></div><span className={assessment.dataQuality.valid && !assessment.dataQuality.stale ? 'outlook-quality' : 'outlook-quality outlook-warning'}>{assessment.dataQuality.valid && !assessment.dataQuality.stale ? 'Data quality acceptable' : 'Data quality limits conclusion'}</span><p>{result?.source} · candles last updated {new Date(result?.lastSuccessfulUpdate || '').toLocaleString()} · analysis {new Date(assessment.analysisTimestamp).toLocaleString()}</p>{(!assessment.dataQuality.valid || assessment.dataQuality.stale) && <div className="market-warning">{assessment.dataQuality.issues.join(' ') || 'Verify candle freshness and quality before relying on this result.'}</div>}</section>
      <div className="outlook-columns"><section className="feature-card"><h2>Technical evidence</h2><h3>Supporting</h3>{assessment.supportingEvidence.length ? <ul>{assessment.supportingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No supporting rule evidence.</p>}<h3>Conflicting</h3>{assessment.conflictingEvidence.length ? <ul>{assessment.conflictingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No conflict detected in evaluated rules.</p>}<h3>Invalidation and confirmation</h3><ul>{assessment.invalidationConditions.map((item, index) => <li key={`i-${index}`}>{item}</li>)}{assessment.requiredConfirmation.map((item, index) => <li key={`c-${index}`}>Confirm: {item}</li>)}</ul></section>
        <section className="feature-card"><h2>Official U.S. macro headlines</h2><p className="outlook-disclaimer">These are source headlines, not a market-impact rating. No consensus forecasts or event values are provided.</p>{newsWarning && <div className="market-warning">{newsWarning}</div>}{news.length ? news.map((item) => <article className="outlook-news-item" key={item.url}><small>{item.source} · {item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'time unavailable'}</small><a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={11}/></a></article>) : !newsWarning ? <p>No headline items were returned.</p> : null}<div className="outlook-calendar-links"><a href={`https://www.bls.gov/schedule/${new Date().getUTCFullYear()}/`} target="_blank" rel="noreferrer">BLS release schedule <ExternalLink size={11}/></a><a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noreferrer">FOMC calendar <ExternalLink size={11}/></a></div></section></div>
      <section className="feature-card outlook-backtest"><h2>Historical base rate · this rule set</h2><p className="outlook-disclaimer">A bounded replay of the same deterministic rules over recent closed candles. It is an empirical sample, not a forecast, and it is not a profitability estimate.</p>{backtestWarning && <div className="market-warning">{backtestWarning}</div>}{backtest && <>
        <div className="analytics-row"><span>Evaluation points</span><b>{backtest.evaluationPoints}</b></div>
        <div className="analytics-row"><span>Qualified states found</span><b>{backtest.byState.Qualified ?? 0}</b></div>
        {backtest.totals.resolved > 0 ? <>
          <div className="analytics-row"><span>Target hit ({backtest.engineInput.riskReward}R) / stop hit</span><b>{backtest.totals.target} / {backtest.totals.stop}</b></div>
          <div className="analytics-row"><span>Resolved sample</span><b>{backtest.totals.resolved}</b></div>
          <div className="analytics-row"><span>Win rate excluding expiry</span><b>{backtest.totals.winRate === null ? 'n/a' : `${Math.round(backtest.totals.winRate * 100)}%`}</b></div>
          <div className="analytics-row"><span>Average R (expiry counted as 0)</span><b>{backtest.totals.averageR === null ? 'n/a' : backtest.totals.averageR.toFixed(2)}</b></div>
          {backtest.totals.expired > 0 && <div className="analytics-row"><span>Expired without target or stop ({backtest.engineInput.forwardBars} bars)</span><b>{backtest.totals.expired}</b></div>}
        </> : <p>No Qualified state resolved within the replay window, so no base rate can be shown. That is a valid, honest result.</p>}
        <h3>Caveats</h3><ul>{backtest.caveats.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </>}</section>
      {scenarios && <section className="feature-card outlook-scenarios"><h2>Conditional scenarios · no confidence score</h2><p className="outlook-disclaimer">Every level below comes from the engine's own swings, liquidity pools, gaps, and order blocks. Scenarios are conditional rule descriptions, not probabilities.</p>{scenarios.lastPrice !== null && <p className="smc-timeframe-note">Reference price {scenarios.lastPrice.toFixed(6)} · state {scenarios.state} · bias {scenarios.bias}</p>}{scenarios.scenarios.map((scenario, index) => <article className={`outlook-scenario outlook-scenario-${scenario.kind}`} key={`${scenario.kind}-${index}`}><div className="outlook-scenario-head"><b>{scenario.title}</b><span>{scenario.kind}</span></div><p>{scenario.thesis}</p>{scenario.entryZones.length > 0 && <><h3>Entry zones</h3><ul>{scenario.entryZones.map((zone, zoneIndex) => <li key={`z-${zoneIndex}`}>{zone.label} <small>· {zone.source}</small></li>)}</ul></>}{scenario.targets.length > 0 && <><h3>Targets</h3><ul>{scenario.targets.map((target, targetIndex) => <li key={`t-${targetIndex}`}>{target.label} <small>· {target.source}</small></li>)}</ul></>}<h3>Triggers</h3><ul>{scenario.triggers.map((trigger, triggerIndex) => <li key={`tr-${triggerIndex}`}>{trigger}</li>)}</ul><h3>Invalidation</h3><ul>{scenario.invalidation.map((item, invalidIndex) => <li key={`i-${invalidIndex}`}>{item}</li>)}</ul></article>)}{scenarios.historicalContext && <p className="smc-timeframe-note">Historical context from the base rate: {scenarios.historicalContext.resolved} resolved sample{scenarios.historicalContext.winRate === null ? '' : `, ${Math.round(scenarios.historicalContext.winRate * 100)}% target-hit at ${scenarios.historicalContext.riskReward}R`}. This is sample context, not this scenario's probability.</p>}<ul className="outlook-scenario-notes">{scenarios.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>}
      <p className="smc-engine-note">This page reports sourced information, deterministic technical rules, an explicitly bounded historical base rate, and conditional scenarios without invented confidence. It does not infer news impact or provide an execution signal.</p>
    </>}
  </div>;
}
