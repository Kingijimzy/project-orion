import type { AssistantMode } from './provider';
import type { SMCMarketRequest } from '@/lib/smc/market-analysis';

export type ChatImage = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; name?: string };
export type ChatRequestBody = { conversationId: string; message: string; image?: ChatImage; mode: AssistantMode; provider: 'gemini' | 'openrouter'; model: string; retry: boolean; smcRequest?: SMCMarketRequest };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set<AssistantMode>(['general', 'trading-coach', 'chart-analysis', 'journal-review']);

export function validateChatRequest(value: unknown): ChatRequestBody | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.conversationId !== 'string' || !UUID.test(body.conversationId)) return null;
  if (typeof body.message !== 'string' || body.message.length > 12_000) return null;
  const message = body.message.trim();
  let image: ChatImage | undefined;
  if (body.image !== undefined) {
    if (!body.image || typeof body.image !== 'object') return null;
    const raw = body.image as Record<string, unknown>;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(raw.mimeType))) return null;
    if (typeof raw.data !== 'string' || raw.data.length < 16 || raw.data.length > 5_600_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data) || raw.data.length % 4 !== 0) return null;
    if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > 180)) return null;
    image = { mimeType: raw.mimeType as ChatImage['mimeType'], data: raw.data, ...(typeof raw.name === 'string' ? { name: raw.name } : {}) };
  }
  if (!message && !image) return null;
  if (body.provider !== 'gemini' && body.provider !== 'openrouter') return null;
  if (typeof body.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(body.model)) return null;
  if (typeof body.mode !== 'string' || !MODES.has(body.mode as AssistantMode)) return null;
  if (body.retry !== undefined && typeof body.retry !== 'boolean') return null;
  let smcRequest: SMCMarketRequest | undefined;
  if (body.smcRequest !== undefined) {
    if (!body.smcRequest || typeof body.smcRequest !== 'object') return null;
    const request = body.smcRequest as Record<string, unknown>;
    const symbol = typeof request.symbol === 'string' ? request.symbol.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !['spot','linear','inverse'].includes(String(request.category)) || !['30','60'].includes(String(request.timeframe))) return null;
    smcRequest = { symbol, category: request.category as SMCMarketRequest['category'], timeframe: request.timeframe as SMCMarketRequest['timeframe'] };
  }
  return { conversationId: body.conversationId, message: message || `[Please analyze the attached image${image?.name ? `: ${image.name}` : ''}.]`, ...(image ? { image } : {}), provider: body.provider, model: body.model, mode: body.mode as AssistantMode, retry: body.retry === true, ...(smcRequest ? { smcRequest } : {}) };
}

export function validateConversationTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 && title.length <= 120 ? title : null;
}
