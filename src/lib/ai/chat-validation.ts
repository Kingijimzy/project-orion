import type { AssistantMode } from './provider';
import type { SMCMarketRequest } from '@/lib/smc/market-analysis';

export type ChatImage = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };
export type ChatRequestBody = { conversationId: string; message: string; mode: AssistantMode; provider: 'gemini' | 'openrouter'; model: string; retry: boolean; image?: ChatImage; smcRequest?: SMCMarketRequest };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set<AssistantMode>(['general', 'trading-coach', 'chart-analysis', 'journal-review']);
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function parseChartImage(value: unknown): ChatImage | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const match = IMAGE_DATA_URL.exec(value);
  if (!match) return null;
  const mimeType = match[1] as ChatImage['mimeType'];
  const base64 = match[2];
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== base64) return null;
  const isPng = mimeType === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = mimeType === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = mimeType === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return isPng || isJpeg || isWebp ? { mimeType, base64 } : null;
}

export function validateChatRequest(value: unknown): ChatRequestBody | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.conversationId !== 'string' || !UUID.test(body.conversationId)) return null;
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 12_000) return null;
  if (body.provider !== 'gemini' && body.provider !== 'openrouter') return null;
  if (typeof body.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(body.model)) return null;
  if (typeof body.mode !== 'string' || !MODES.has(body.mode as AssistantMode)) return null;
  if (body.retry !== undefined && typeof body.retry !== 'boolean') return null;
  const image = parseChartImage(body.imageDataUrl);
  if (image === null || (image && body.provider !== 'openrouter')) return null;
  let smcRequest: SMCMarketRequest | undefined;
  if (body.smcRequest !== undefined) {
    if (!body.smcRequest || typeof body.smcRequest !== 'object') return null;
    const request = body.smcRequest as Record<string, unknown>;
    const symbol = typeof request.symbol === 'string' ? request.symbol.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !['spot','linear','inverse'].includes(String(request.category)) || !['30','60'].includes(String(request.timeframe))) return null;
    smcRequest = { symbol, category: request.category as SMCMarketRequest['category'], timeframe: request.timeframe as SMCMarketRequest['timeframe'] };
  }
  return { conversationId: body.conversationId, message: body.message.trim(), provider: body.provider, model: body.model, mode: body.mode as AssistantMode, retry: body.retry === true, ...(image ? { image } : {}), ...(smcRequest ? { smcRequest } : {}) };
}

export function validateConversationTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 && title.length <= 120 ? title : null;
}
