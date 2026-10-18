import { FOREX_PAIRS, type ForexPair } from './twelve-data-forex';
import { isBybitCategory, type BybitCategory } from './bybit';

export type AssetClass = 'crypto' | 'forex';
export type ProviderId = 'bybit' | 'twelve-data';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

export type Instrument = {
  assetClass: AssetClass;
  provider: ProviderId;
  symbol: string;
  displaySymbol: string;
  base: string;
  quote: string;
  category?: BybitCategory;
};

const CRYPTO_QUOTES = ['USDT', 'USDC', 'TUSD', 'DAI', 'USD', 'BTC', 'ETH', 'EUR', 'GBP'] as const;
const SEPARATED = /^([A-Z]{2,10})[\/\-_]([A-Z]{2,10})$/;

function splitSeparated(raw: string): [string, string] | null {
  const match = raw.match(SEPARATED);
  return match ? [match[1], match[2]] : null;
}

function cryptoQuote(compact: string): [string, string] | null {
  for (const quote of CRYPTO_QUOTES) {
    if (compact.length > quote.length + 1 && compact.endsWith(quote)) return [compact.slice(0, compact.length - quote.length), quote];
  }
  return null;
}

export function forexInstrument(pair: ForexPair): Instrument {
  const [base, quote] = pair.split('/');
  return { assetClass: 'forex', provider: 'twelve-data', symbol: pair, displaySymbol: pair, base, quote };
}

export function cryptoInstrument(symbol: string, category: BybitCategory = 'linear'): Instrument {
  const compact = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const split = splitSeparated(symbol.toUpperCase()) ?? cryptoQuote(compact);
  const base = split ? split[0] : compact;
  const quote = split ? split[1] : '';
  return { assetClass: 'crypto', provider: 'bybit', symbol: compact, displaySymbol: quote ? `${base}/${quote}` : compact, base, quote, category };
}

/**
 * Resolves a user-typed instrument to a normalized descriptor. Forex is decided by
 * the fixed supported-pair allowlist (and explicit separators), so a symbol like
 * "BTCUSD" is treated as crypto rather than a forex pair.
 */
export function resolveInstrument(input: string, assetClass?: AssetClass, category: BybitCategory = 'linear'): Instrument | null {
  const raw = input.trim().toUpperCase();
  if (!raw || !/^[A-Z0-9\/\-_]{3,30}$/.test(raw)) return null;
  const separated = splitSeparated(raw);
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (assetClass !== 'crypto') {
    const pair = separated ? `${separated[0]}/${separated[1]}` : compact.length === 6 ? `${compact.slice(0, 3)}/${compact.slice(3)}` : '';
    if ((FOREX_PAIRS as readonly string[]).includes(pair)) return forexInstrument(pair as ForexPair);
    if (assetClass === 'forex') return null;
  }
  if (!/^[A-Z0-9]{2,30}$/.test(compact)) return null;
  return cryptoInstrument(compact, isBybitCategory(category) ? category : 'linear');
}
