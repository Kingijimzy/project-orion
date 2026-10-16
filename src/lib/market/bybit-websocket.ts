import type { BybitCategory, BybitInterval, Candle } from './bybit';

const INTERVALS = new Set<BybitInterval>(['1','3','5','15','30','60','120','240','360','720','D','W','M']);

export function bybitPublicWebSocketUrl(category: BybitCategory) {
  const channel = category === 'spot' ? 'spot' : category === 'inverse' ? 'inverse' : 'linear';
  return `wss://stream.bybit.com/v5/public/${channel}`;
}

export function bybitKlineTopic(interval: BybitInterval, symbol: string) {
  return `kline.${interval}.${symbol}`;
}

function finite(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBybitKlineMessage(value: unknown, expectedTopic: string): Candle | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as { topic?: unknown; data?: unknown };
  if (message.topic !== expectedTopic || !Array.isArray(message.data) || !message.data[0] || typeof message.data[0] !== 'object') return null;
  const item = message.data[0] as Record<string, unknown>;
  const expectedInterval = expectedTopic.split('.')[1];
  if (typeof item.interval !== 'string' || !INTERVALS.has(item.interval as BybitInterval) || item.interval !== expectedInterval) return null;
  const startTime = finite(item.start), open = finite(item.open), high = finite(item.high), low = finite(item.low), close = finite(item.close), volume = finite(item.volume), turnover = finite(item.turnover);
  if (startTime === null || !Number.isSafeInteger(startTime) || startTime <= 0 || open === null || high === null || low === null || close === null || volume === null || turnover === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 || turnover < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
  if (typeof item.confirm !== 'boolean') return null;
  return { startTime, open, high, low, close, volume, turnover, closed: item.confirm };
}
