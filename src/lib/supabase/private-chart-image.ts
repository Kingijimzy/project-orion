const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(png|jpg|webp)$/i;

export function validatePrivateChartImagePath(value: unknown, userId: string, conversationId?: string): string | null {
  if (typeof value !== 'string' || value.length > 160 || !UUID.test(userId)) return null;
  const match = IMAGE_PATH.exec(value);
  if (!match || !UUID.test(match[1]) || !UUID.test(match[2]) || !UUID.test(match[3])) return null;
  if (match[1].toLowerCase() !== userId.toLowerCase()) return null;
  if (conversationId && match[2].toLowerCase() !== conversationId.toLowerCase()) return null;
  return value;
}

export function privateChartImagePath(userId: string, conversationId: string, mimeType: 'image/png' | 'image/jpeg' | 'image/webp', id: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  return `${userId}/${conversationId}/${id}.${extension}`;
}

export function privateChartImageContentType(path: string): string | null {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return null;
}
