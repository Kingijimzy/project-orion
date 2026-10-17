'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, CircleHelp, ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';

type JournalRecord = {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stop_loss: number | null;
  exit_price: number | null;
  outcome: 'open' | 'win' | 'loss' | 'breakeven' | 'unknown';
  setup_type: string | null;
  rule_compliance: boolean | null;
  execution_quality: number | null;
  created_at: string;
};

const lessonItems = [
  { title: 'Market structure', group: 'Structure', body: 'A swing is useful only after the bars needed to confirm it have closed. A break of structure describes a close through a previously confirmed swing; it does not predict what happens next.' },
  { title: 'Liquidity and stop clusters', group: 'Structure', body: 'Equal highs or lows can mark areas where orders may cluster. A wick through a level shows a breach; it does not prove that a reversal followed.' },
  { title: 'Fair value gaps', group: 'Structure', body: 'A fair value gap is a three-candle price imbalance under a stated rule. Track whether it is untouched, partially filled, fully filled, or invalidated; do not assume price must return to it.' },
  { title: 'Order blocks', group: 'Structure', body: 'Treat an order block as a rule-defined candidate with explicit displacement and break evidence. The label alone does not establish institutional activity or a valid trade.' },
  { title: 'Forex pips and pairs', group: 'Forex', body: 'Most non-JPY pairs conventionally quote a pip at 0.0001; JPY pairs commonly use 0.01. Confirm the broker contract specification and account currency before sizing.' },
  { title: 'Spread, slippage, and costs', group: 'Risk', body: 'Spread is the difference between bid and ask. Add commissions, financing, and slippage assumptions before comparing a target with planned risk.' },
  { title: 'Economic releases', group: 'News', body: 'CPI, employment, GDP, central-bank decisions, and PMI can move markets. Check the original publisher, release time zone, actual versus forecast values, and data timestamp.' },
  { title: 'Trading discipline', group: 'Process', body: 'Write the setup, invalidation, and risk before entry. Review rule-following separately from whether the trade won or lost; one outcome does not validate a process.' },
];

export function HomeWorkspacePage({ onNavigate, signedIn, providerConfigured, providerModel, marketSymbol, marketUpdated, candleCount }: {
  onNavigate: (page: string) => void;
  signedIn: boolean;
  providerConfigured: boolean;
  providerModel?: string | null;
  marketSymbol: string;
  marketUpdated: string;
  candleCount: number;
}) {
  const links = [
    ['AI Chat', 'Ask the configured provider; streaming needs a signed-in account.'],
    ['Markets', 'Bybit public crypto candles, search, and watchlist.'],
    ['Forex Reference', 'Daily reference rates, not live broker quotes.'],
    ['SMC Scanner', 'Deterministic multi-timeframe analysis from Bybit candles.'],
    ['Trading Tools', 'Risk, position sizing, pip, and cost calculators.'],
    ['Trading Journal', 'Private saved trade records and separate reviews.'],
  ];
  return <div className="feature-page">
    <header><div className="eyebrow">ORION · TRADING WORKSPACE</div><h1>Overview</h1><p>Quick access to tools that are connected to real data or your saved records.</p></header>
    <div className="dashboard-status-grid">
      <section className="feature-card"><small>AI PROVIDER</small><b className={providerConfigured ? 'status-good' : 'status-warn'}>{providerConfigured ? 'OpenRouter configured' : 'Setup needed'}</b><span>{providerConfigured ? providerModel || 'Selected model is configured' : 'No response is simulated. Configure server environment variables.'}</span></section>
      <section className="feature-card"><small>ACCOUNT</small><b className={signedIn ? 'status-good' : 'status-warn'}>{signedIn ? 'Signed in' : 'Sign-in required'}</b><span>{signedIn ? 'Private journal and chat history are available.' : 'Sign in before using private chat or persistence.'}</span></section>
      <section className="feature-card"><small>MARKET DATA</small><b>{candleCount > 0 ? `${marketSymbol} · ${candleCount} candles` : 'Not loaded this session'}</b><span>{marketUpdated ? `Last successful update ${new Date(marketUpdated).toLocaleString()}` : 'Open Markets to request current public Bybit data.'}</span></section>
    </div>
    <section className="feature-card"><h2>Open a workspace</h2><div className="dashboard-links">{links.map(([name, description]) => <button key={name} onClick={() => onNavigate(name)}><b>{name}</b><span>{description}</span><ExternalLink size={14}/></button>)}</div></section>
    <p className="tool-assumption">Orion provides analysis and education. It does not place trades.</p>
  </div>;
}

export function AnalyticsWorkspacePage({ signedIn }: { signedIn: boolean }) {
  const [entries, setEntries] = useState<JournalRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setBusy(true); setError('');
    void fetch('/api/journal', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const data = await response.json() as { entries?: JournalRecord[]; message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not load journal records.');
      setEntries(data.entries || []);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not load journal records.');
    }).finally(() => setBusy(false));
    return () => controller.abort();
  }, [signedIn, attempt]);

  const metrics = useMemo(() => {
    const closed = entries.filter((entry) => ['win', 'loss', 'breakeven'].includes(entry.outcome));
    const wins = closed.filter((entry) => entry.outcome === 'win').length;
    const knownCompliance = entries.filter((entry) => entry.rule_compliance !== null);
    const realizedR = closed.flatMap((entry) => {
      const stop = entry.stop_loss;
      if (stop === null || !entry.exit_price || !Number.isFinite(entry.entry) || entry.entry === stop) return [];
      const risk = Math.abs(entry.entry - stop);
      const pnl = entry.direction === 'long' ? entry.exit_price - entry.entry : entry.entry - entry.exit_price;
      return [pnl / risk];
    });
    const setups = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.setup_type?.trim() || 'Unspecified';
      setups.set(key, (setups.get(key) || 0) + 1);
    }
    return { closed, wins, winRate: closed.length ? wins / closed.length * 100 : null, compliance: knownCompliance.length ? knownCompliance.filter((entry) => entry.rule_compliance).length / knownCompliance.length * 100 : null, realizedR, setups: [...setups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [entries]);

  return <div className="feature-page">
    <header><div className="eyebrow"><Activity size={13}/> JOURNAL-BASED · REAL SAVED RECORDS</div><h1>Analytics</h1><p>Calculated only from your saved journal. No sample trades or simulated performance are included.</p></header>
    {!signedIn ? <div className="feature-notice">Sign in to view private journal analytics.</div> : <>
      {error && <div className="inline-error" role="alert">{error} <button onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {busy && <div className="feature-notice"><LoaderCircle size={14} className="spin"/> Loading saved trades…</div>}
      {!busy && !error && entries.length === 0 && <div className="feature-notice">No journal records yet. Add a trade in Trading Journal to start building this view.</div>}
      {!error && entries.length > 0 && <>
        <div className="dashboard-status-grid">
          <section className="feature-card"><small>RECORDED TRADES</small><b>{entries.length}</b><span>From your private journal</span></section>
          <section className="feature-card"><small>CLOSED SAMPLE</small><b>{metrics.closed.length} / 10</b><span>{metrics.closed.length < 10 ? 'Win rate is withheld until 10 closed trades.' : 'Win rate is descriptive, not predictive.'}</span></section>
          <section className="feature-card"><small>RULE COMPLIANCE</small><b>{metrics.compliance === null ? 'Not recorded' : `${metrics.compliance.toFixed(1)}%`}</b><span>Only entries with a compliance value are counted.</span></section>
          <section className="feature-card"><small>REALIZED R SAMPLE</small><b>{metrics.realizedR.length ? `${(metrics.realizedR.reduce((sum, value) => sum + value, 0) / metrics.realizedR.length).toFixed(2)}R avg` : 'Unavailable'}</b><span>Closed trades with entry, stop, and exit prices.</span></section>
        </div>
        {metrics.closed.length >= 10 && <section className="feature-card"><h2>Closed outcomes</h2><p>{metrics.wins} wins · {metrics.closed.filter((entry) => entry.outcome === 'loss').length} losses · {metrics.closed.filter((entry) => entry.outcome === 'breakeven').length} breakeven · {metrics.winRate?.toFixed(1)}% wins in this recorded sample.</p></section>}
        <section className="feature-card"><h2>Most recorded setups</h2>{metrics.setups.length ? metrics.setups.map(([name, count]) => <div className="analytics-row" key={name}><span>{name}</span><b>{count}</b></div>) : <p>No setup labels recorded.</p>}</section>
      </>}
      <button className="market-refresh" onClick={() => setAttempt((value) => value + 1)} disabled={busy}><RotateCcw size={14}/> Refresh journal data</button>
    </>}
  </div>;
}

export function LessonsWorkspacePage() {
  const [query, setQuery] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  useEffect(() => {
    try { setCompleted(JSON.parse(localStorage.getItem('orion-lesson-progress') || '[]') as string[]); } catch { setCompleted([]); }
  }, []);
  const visible = lessonItems.filter((item) => `${item.title} ${item.group} ${item.body}`.toLowerCase().includes(query.toLowerCase()));
  function toggle(title: string) {
    const next = completed.includes(title) ? completed.filter((item) => item !== title) : [...completed, title];
    setCompleted(next);
    try { localStorage.setItem('orion-lesson-progress', JSON.stringify(next)); } catch { /* progress remains in this session */ }
  }
  return <div className="feature-page">
    <header><div className="eyebrow"><BookOpen size={13}/> LEARNING NOTES</div><h1>Lessons</h1><p>Short practical notes. Completion is saved in this browser only; this is not personal AI memory and is not sent to the model.</p></header>
    <label className="lesson-search">SEARCH TOPICS<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Structure, forex, risk…" /></label>
    <div className="lesson-list">{visible.map((item) => <article className="feature-card lesson-item" key={item.title}><div><small>{item.group}</small><h2>{item.title}</h2></div><p>{item.body}</p><button onClick={() => toggle(item.title)}>{completed.includes(item.title) ? 'Completed · mark to revisit' : 'Mark as reviewed'}</button></article>)}</div>
    {visible.length === 0 && <div className="feature-notice">No lesson matches “{query}”.</div>}
    <div className="feature-notice"><CircleHelp size={14}/> Lessons are educational material, not individualized financial advice.</div>
  </div>;
}

export function SettingsWorkspacePage({ providerConfigured, providerModel, geminiConfigured, supabaseReady, signedIn }: {
  providerConfigured: boolean;
  providerModel?: string | null;
  geminiConfigured: boolean;
  supabaseReady: boolean;
  signedIn: boolean;
}) {
  return <div className="feature-page">
    <header><div className="eyebrow">CONFIGURATION · SERVER CREDENTIALS HIDDEN</div><h1>Settings & integrations</h1><p>Connection summaries only. Orion never sends provider secrets to this screen.</p></header>
    <section className="feature-card"><h2>AI providers</h2><div className="analytics-row"><span>OpenRouter primary</span><b className={providerConfigured ? 'status-good' : 'status-warn'}>{providerConfigured ? 'Configured' : 'Needs setup'}</b></div><p>{providerModel || 'Model status is not available.'}</p><div className="analytics-row"><span>Gemini optional</span><b className={geminiConfigured ? 'status-good' : 'status-warn'}>{geminiConfigured ? 'Configured' : 'Not configured'}</b></div><p>Paid-model access must remain disabled. OpenRouter requires a catalogue-verified free model.</p><small>Server variables: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_ALLOW_PAID_MODEL. Optional Gemini: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_ALLOW_PAID_MODEL.</small></section>
    <section className="feature-card"><h2>Supabase authentication and storage</h2><div className="analytics-row"><span>Project configuration</span><b className={supabaseReady ? 'status-good' : 'status-warn'}>{supabaseReady ? 'Configured' : 'Needs setup'}</b></div><p>{signedIn ? 'Signed in. Chat and journal routes enforce user ownership.' : 'Not signed in. Private persistence features are unavailable.'}</p><small>Use only the public anon/publishable key in NEXT_PUBLIC_SUPABASE_ANON_KEY. Never add a service-role key.</small></section>
    <section className="feature-card"><h2>Market sources</h2><p>Crypto candles: Bybit V5 public market data, no private trading key. Forex Reference: Frankfurter daily reference data; not live/intraday. News and the U.S. BLS/Federal Reserve event calendar use official public sources; consensus forecasts and impact scores are unavailable.</p></section>
  </div>;
}
