export const FOREX_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'NZD/USD', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'AUD/CAD', 'GBP/CAD', 'GBP/AUD'] as const;
export const FOREX_INTERVALS = ['1min', '5min', '15min', '30min', '1h', '4h', '1day'] as const;
export type ForexPair = typeof FOREX_PAIRS[number];
export type ForexInterval = typeof FOREX_INTERVALS[number];

export type ForexCandle = { timestamp: number; open: number; high: number; low: number; close: number; closed: boolean };
export type TwelveDataPayload = { meta?: { symbol?: string; interval?: string; exchange_timezone?: string }; values?: Array<Record<string, unknown>>; status?: string; code?: number; message?: string };

const INTERVAL_MS: Record<ForexInterval, number> = {
  '1min': 60_000, '5min': 5 * 60_000, '15min': 15 * 60_000, '30min': 30 * 60_000,
  '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1day': 24 * 60 * 60_000,
};

function number(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTwelveDataCandles(payload: TwelveDataPayload, pair: ForexPair, interval: ForexInterval, now = Date.now()): ForexCandle[] | null {
  if (payload.status === 'error' || !Array.isArray(payload.values) || payload.meta?.symbol?.replaceAll('/', '').toUpperCase() !== pair.replaceAll('/', '')) return null;
  const candles: ForexCandle[] = [];
  for (const row of payload.values) {
    const timestamp = parseTimestamp(row.datetime);
    const open = number(row.open); const high = number(row.high); const low = number(row.low); const close = number(row.close);
    if (timestamp === null || open === null || high === null || low === null || close === null || [open, high, low, close].some((n) => n <= 0) || high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    candles.push({ timestamp, open, high, low, close, closed: timestamp + INTERVAL_MS[interval] <= now });
  }
  if (!candles.length) return null;
  const unique = new Map(candles.map((candle) => [candle.timestamp, candle]));
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function validateForexRequest(pair: string | null, interval: string | null, outputsize: string | null) {
  const rawPair = pair?.trim().toUpperCase().replace('-', '/') ?? '';
  const normalizedPair = rawPair.includes('/') ? rawPair : rawPair.length === 6 ? `${rawPair.slice(0, 3)}/${rawPair.slice(3)}` : rawPair;
  const normalizedInterval = interval?.trim().toLowerCase() ?? '1h';
  const count = outputsize === null ? 120 : Number(outputsize);
  if (!(FOREX_PAIRS as readonly string[]).includes(normalizedPair)) return { ok: false as const, error: 'Choose a supported forex pair.' };
  if (!(FOREX_INTERVALS as readonly string[]).includes(normalizedInterval)) return { ok: false as const, error: 'Choose a supported candle interval.' };
  if (!Number.isInteger(count) || count < 20 || count > 200) return { ok: false as const, error: 'Candle count must be between 20 and 200.' };
  return { ok: true as const, pair: normalizedPair as ForexPair, interval: normalizedInterval as ForexInterval, outputsize: count };
}
