'use client';

import { FormEvent, useState } from 'react';
import { ExternalLink, LoaderCircle, Search } from 'lucide-react';
import type { BybitCategory } from '@/lib/market/bybit';
import type { SMCAssessment } from '@/lib/smc/engine';
import type { OfficialNewsItem } from '@/lib/news/official-feeds';

type OutlookResult = { analysis: SMCAssessment; source: string; lastSuccessfulUpdate: string };

export function MarketOutlookPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [category, setCategory] = useState<BybitCategory>('linear');
  const [timeframe, setTimeframe] = useState<'30' | '60'>('60');
  const [result, setResult] = useState<OutlookResult | null>(null);
  const [news, setNews] = useState<OfficialNewsItem[]>([]);
  const [newsWarning, setNewsWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function analyze(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(''); setNewsWarning('');
    try {
      const marketResponse = await fetch('/api/smc/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, category, timeframe }) });
      const market = await marketResponse.json() as OutlookResult & { message?: string };
      if (!marketResponse.ok) throw new Error(market.message || 'Bybit market analysis is unavailable.');
      setResult(market);
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
      <p className="smc-engine-note">This page reports sourced information and deterministic technical rules. It does not calculate probabilities, infer news impact, or provide an execution signal.</p>
    </>}
  </div>;
}
