'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import type { OfficialNewsItem } from '@/lib/news/official-feeds';
import type { EconomicCalendarEvent } from '@/lib/news/economic-calendar';

type NewsResponse = { items?: OfficialNewsItem[]; unavailableSources?: string[]; message?: string };
type CalendarResponse = { events?: EconomicCalendarEvent[]; unavailableSources?: string[]; message?: string };

function formatCalendarEvent(event: EconomicCalendarEvent) {
  if (event.dateOnly) {
    const start = new Date(`${event.eventDate}T12:00:00Z`);
    const label = start.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (!event.endsAt) return `${label} · exact time not listed`;
    const end = new Date(`${event.endsAt}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    return `${label} – ${end} · time not listed`;
  }
  if (!event.startsAt) return 'Date/time not provided by source';
  return new Date(event.startsAt).toLocaleString(undefined, { timeZone: event.timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function NewsWorkspacePage() {
  const [items, setItems] = useState<OfficialNewsItem[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [events, setEvents] = useState<EconomicCalendarEvent[]>([]);
  const [calendarUnavailable, setCalendarUnavailable] = useState<string[]>([]);
  const [calendarError, setCalendarError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [calendarBusy, setCalendarBusy] = useState(true);
  const [updated, setUpdated] = useState('');
  const [calendarUpdated, setCalendarUpdated] = useState('');
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
  const loadCalendar = useCallback(async () => {
    setCalendarBusy(true); setCalendarError('');
    try {
      const response = await fetch('/api/news/calendar', { cache: 'no-store' });
      const data = await response.json() as CalendarResponse;
      if (!response.ok) throw new Error(data.message || 'Could not load official economic calendars.');
      setEvents(data.events || []); setCalendarUnavailable(data.unavailableSources || []); setCalendarUpdated(new Date().toISOString());
    } catch (failure) { setCalendarError(failure instanceof Error ? failure.message : 'Could not load official economic calendars.'); }
    finally { setCalendarBusy(false); }
  }, []);
  useEffect(() => { void load(); void loadCalendar(); }, [load, loadCalendar]);

  return <div className="news-page">
    <div className="market-heading"><div><div className="eyebrow"><span className="green-pip"/> OFFICIAL ECONOMIC RELEASES</div><h1>News & sessions</h1><p>Upcoming U.S. BLS release dates and Federal Reserve FOMC meetings, plus official source headlines.</p></div><button className="market-refresh" onClick={() => { void load(); void loadCalendar(); }} disabled={busy || calendarBusy}>{busy || calendarBusy ? <><LoaderCircle size={14} className="spin"/> Loading</> : <><RotateCcw size={14}/> Refresh</>}</button></div>
    <section className="news-calendar-note"><div><b>Upcoming economic events · next 120 days</b><p>Scheduled event times are shown in the source timezone. The source calendars do not provide forecast, actual, previous, or impact values here, so Orion leaves them unscored and blank.</p></div><div className="news-calendar-links"><a href="https://www.bls.gov/schedule/" target="_blank" rel="noreferrer">BLS calendar <ExternalLink size={13}/></a><a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noreferrer">FOMC calendar <ExternalLink size={13}/></a></div></section>
    {calendarUpdated && <p className="news-updated">Calendar checked {new Date(calendarUpdated).toLocaleString()} · event schedules remain subject to source changes.</p>}
    {calendarError && <div className="inline-error market-error" role="alert">{calendarError} <button onClick={() => void loadCalendar()}>Retry calendar</button></div>}
    {calendarUnavailable.length > 0 && <div className="market-warning">Some calendar sources could not be reached: {calendarUnavailable.join('; ')}.</div>}
    {calendarBusy && !events.length ? <div className="news-empty"><LoaderCircle size={18} className="spin"/> Loading official calendars…</div> : !events.length && !calendarError ? <div className="news-empty">No upcoming events were returned by the official calendars.</div> : <div className="economic-calendar-list">{events.map((event) => <article key={event.id}><div><span className={`calendar-category calendar-${event.category}`}>{event.category.replace('-', ' ')}</span><span className="calendar-impact">Impact not rated</span></div><h2>{event.title}</h2><p>{formatCalendarEvent(event)}</p><small><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.source} <ExternalLink size={12}/></a> · Forecast, actual and previous values not provided</small></article>)}</div>}
    {updated && <p className="news-updated">Loaded {new Date(updated).toLocaleString()} · source feed timestamps are shown per item.</p>}
    {error && <div className="inline-error market-error" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}
    {unavailable.length > 0 && <div className="market-warning">Some official feeds could not be reached: {unavailable.join('; ')}.</div>}
    {busy && !items.length ? <div className="news-empty"><LoaderCircle size={18} className="spin"/> Loading verified source feeds…</div> : !items.length && !error ? <div className="news-empty">No current release items were returned by the source feeds.</div> : <div className="news-list">{items.map((item, index) => <article key={`${item.url}-${index}`}><div className="news-meta"><span>{item.topic}</span><span>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Source did not provide a publication time'}</span></div><h2><a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={13}/></a></h2>{item.summary && <p>{item.summary}</p>}<small>{item.source} · sourced feed item, not Orion analysis</small></article>)}</div>}
  </div>;
}
