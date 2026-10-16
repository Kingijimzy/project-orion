'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, RotateCcw } from 'lucide-react';

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
type RatesResponse = {
  source: string;
  kind: 'daily_reference_not_intraday';
  base: string;
  date: string | null;
  rates: Record<string, number>;
  missing: string[];
  fetchedAt: string;
};
type ApiError = { message?: string };

async function readError(response: Response) {
  try { return (await response.json() as ApiError).message || 'Could not load reference rates.'; }
  catch { return 'Could not load reference rates.'; }
}

export function ForexReferencePage() {
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('EUR');
  const [amount, setAmount] = useState('1');
  const [data, setData] = useState<RatesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ base, symbols: currencies.join(',') });
      const response = await fetch(`/api/forex/rates?${params}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as RatesResponse;
      if (result.kind !== 'daily_reference_not_intraday' || !result.rates || result.base !== base) {
        throw new Error('The provider response did not contain labeled daily reference rates.');
      }
      setData(result);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Could not load reference rates.');
    } finally { setBusy(false); }
  }, [base]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

  const quoteOptions = currencies.filter((currency) => currency !== base);
  useEffect(() => {
    if (quote === base) setQuote(quoteOptions[0] || 'EUR');
  }, [base, quote, quoteOptions]);

  const selectedRate = quote === base ? 1 : data?.rates[quote];
  const converted = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value >= 0 && selectedRate !== undefined ? value * selectedRate : null;
  }, [amount, selectedRate]);

  return <div className="feature-page">
    <header>
      <div className="eyebrow">FOREX · CENTRAL-BANK REFERENCE DATA</div>
      <h1>FX reference rates</h1>
      <p>Daily mid-market reference rates from Frankfurter. These are not broker quotes, intraday candles, or executable prices.</p>
    </header>
    <section className="feature-card">
      <div className="forex-controls">
        <label>BASE CURRENCY<select value={base} onChange={(event) => setBase(event.target.value)}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        <label>QUOTE CURRENCY<select value={quote} onChange={(event) => setQuote(event.target.value)}>{quoteOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        <label>AMOUNT<input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <button className="market-refresh" onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
          {busy ? <><LoaderCircle size={14} className="spin"/> Loading</> : <><RotateCcw size={14}/> Refresh</>}
        </button>
      </div>
      {error && <div className="inline-error market-error" role="alert">{error}<button onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
      {data && <>
        <div className="forex-rate-summary">
          <small>{data.date ? `Observation date · ${data.date}` : 'No valid observation date returned'}</small>
          <b>{converted === null ? 'Rate unavailable' : `${Number(amount).toLocaleString()} ${base} = ${converted.toLocaleString(undefined, { maximumSignificantDigits: 9 })} ${quote}`}</b>
          <span>{data.source} · received {new Date(data.fetchedAt).toLocaleString()}</span>
        </div>
        {busy && <div className="feature-notice">Refreshing rates… The previous observation remains visible.</div>}
        <div className="forex-rate-list" aria-label="Daily reference rates">
          {quoteOptions.map((currency) => {
            const rate = data.rates[currency];
            return <button key={currency} className={`forex-rate-row ${quote === currency ? 'forex-rate-selected' : ''}`} onClick={() => setQuote(currency)} disabled={rate === undefined}>
              <span><b>{base}/{currency}</b><small>Daily reference · not a live quote</small></span>
              <strong>{rate === undefined ? 'Unavailable' : rate.toLocaleString(undefined, { maximumSignificantDigits: 9 })}</strong>
            </button>;
          })}
        </div>
        {data.missing.length > 0 && <p className="tool-assumption">No rate was returned for: {data.missing.join(', ')}. No values are estimated.</p>}
      </>}
      {!data && !error && <div className="feature-notice">{busy ? 'Loading real reference rates…' : 'No reference data is available.'}</div>}
    </section>
    <section className="feature-card">
      <h2>Data limits</h2>
      <p>Frankfurter uses public reference-rate data with no API key. Rates update on provider publication schedules (generally daily) and may be missing or revised. Orion does not use these values as live forex trading prices and does not provide forex OHLC candles from this source.</p>
    </section>
  </div>;
}
