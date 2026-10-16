'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import type { OfficialNewsItem } from '@/lib/news/official-feeds';

type NewsResponse = { items?: OfficialNewsItem[]; unavailableSources?: string[]; message?: string };

export function NewsWorkspacePage() {
  const [items, setItems] = useState<OfficialNewsItem[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [updated, setUpdated] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/news', { cache: 'no-store' });
      const data = await response.json() as NewsResponse;
      if (!response.ok) throw new Error(data.message || 'Could not load official news feeds.');
      setItems(data.items || []); setUnavailable(data.unavailableSources || []); setUpdated(new Date().toISOString());
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load official news feeds.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="news-page">
    <div className="market-heading"><div><div className="eyebrow"><span className="green-pip"/> OFFICIAL ECONOMIC RELEASES</div><h1>News & sessions</h1><p>Headlines from U.S. BLS and Federal Reserve primary-source feeds.</p></div><button className="market-refresh" onClick={() => void load()} disabled={busy}>{busy ? <><LoaderCircle size={14} className="spin"/> Loading</> : <><RotateCcw size={14}/> Refresh</>}</button></div>
    <div className="news-calendar-note"><div><b>Economic release schedule</b><p>BLS publishes upcoming U.S. release dates and times in Eastern Time. Orion links to its official schedule; it does not yet ingest event forecasts, actual/previous values, or non-U.S. calendars.</p></div><a href={`https://www.bls.gov/schedule/${new Date().getUTCFullYear()}/`} target="_blank" rel="noreferrer">Open BLS calendar <ExternalLink size={13}/></a></div>
    {updated && <p className="news-updated">Loaded {new Date(updated).toLocaleString()} · source feed timestamps are shown per item.</p>}
    {error && <div className="inline-error market-error" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}
    {unavailable.length > 0 && <div className="market-warning">Some official feeds could not be reached: {unavailable.join('; ')}.</div>}
    {busy && !items.length ? <div className="news-empty"><LoaderCircle size={18} className="spin"/> Loading verified source feeds…</div> : !items.length && !error ? <div className="news-empty">No current release items were returned by the source feeds.</div> : <div className="news-list">{items.map((item, index) => <article key={`${item.url}-${index}`}><div className="news-meta"><span>{item.topic}</span><span>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Source did not provide a publication time'}</span></div><h2><a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={13}/></a></h2>{item.summary && <p>{item.summary}</p>}<small>{item.source} · sourced feed item, not Orion analysis</small></article>)}</div>}
  </div>;
}
