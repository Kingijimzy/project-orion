export type JournalEntryInput = {
  analysisId?: string | null; symbol: string; direction: 'long' | 'short'; timeframe: string;
  entry: number; stopLoss?: number | null; target?: number | null; exitPrice?: number | null;
  outcome: 'open' | 'win' | 'loss' | 'breakeven' | 'unknown'; setupType?: string; reasoning?: string;
  screenshotRefs?: string[]; setupQuality?: number | null; ruleCompliance?: boolean | null;
  executionQuality?: number | null; confidence?: number | null; hesitation?: string; fomo?: string; notes?: string;
};
export function validateJournalEntry(v: unknown): { ok: true; value: JournalEntryInput } | { ok: false; error: string } {
  if (!v || typeof v !== 'object') return { ok: false, error: 'Entry must be an object.' };
  const x = v as Record<string, unknown>;
  const symbol = typeof x.symbol === 'string' ? x.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) return { ok: false, error: 'Enter a valid symbol.' };
  if (x.direction !== 'long' && x.direction !== 'short') return { ok: false, error: 'Direction must be long or short.' };
  if (typeof x.timeframe !== 'string' || x.timeframe.length > 12 || !x.timeframe.trim()) return { ok: false, error: 'Enter a timeframe.' };
  const number = (key: string, required = false): number | null => { const n = x[key]; if (n === undefined || n === null || n === '') return required ? NaN : null; return typeof n === 'number' ? n : NaN; };
  const entry = number('entry', true), stopLoss = number('stopLoss'), target = number('target'), exitPrice = number('exitPrice');
  if (![entry, stopLoss, target, exitPrice].every(n => n === null || Number.isFinite(n) && n > 0)) return { ok: false, error: 'Entry, stop, target, and exit prices must be positive numbers.' };
  if (!['open', 'win', 'loss', 'breakeven', 'unknown'].includes(String(x.outcome))) return { ok: false, error: 'Choose a valid outcome.' };
  if (x.analysisId !== undefined && x.analysisId !== null && typeof x.analysisId !== 'string') return { ok: false, error: 'Analysis reference is invalid.' };
  if (x.ruleCompliance !== undefined && x.ruleCompliance !== null && typeof x.ruleCompliance !== 'boolean') return { ok: false, error: 'Rule compliance must be yes, no, or unset.' };
  for (const key of ['setupQuality', 'executionQuality'] as const) if (x[key] !== undefined && x[key] !== null && (!Number.isInteger(x[key]) || Number(x[key]) < 1 || Number(x[key]) > 5)) return { ok: false, error: `${key} must be from 1 to 5.` };
  if (x.confidence !== undefined && x.confidence !== null && (!Number.isInteger(x.confidence) || Number(x.confidence) < 1 || Number(x.confidence) > 10)) return { ok: false, error: 'Confidence must be from 1 to 10.' };
  const strings = ['setupType', 'reasoning', 'hesitation', 'fomo', 'notes'] as const;
  for (const k of strings) if (x[k] !== undefined && (typeof x[k] !== 'string' || x[k].length > 6000)) return { ok: false, error: `${k} must be text up to 6000 characters.` };
  const refs = x.screenshotRefs ?? [];
  if (!Array.isArray(refs) || refs.length > 8 || refs.some(r => typeof r !== 'string' || r.length > 2048)) return { ok: false, error: 'Use up to 8 screenshot references, each up to 2048 characters.' };
  return { ok: true, value: {
    analysisId: (x.analysisId as string | null | undefined) ?? null, symbol, direction: x.direction,
    timeframe: x.timeframe.trim(), entry: entry!, stopLoss, target, exitPrice, outcome: x.outcome as JournalEntryInput['outcome'],
    setupType: String(x.setupType ?? ''), reasoning: String(x.reasoning ?? ''), screenshotRefs: refs as string[],
    setupQuality: (x.setupQuality as number | null | undefined) ?? null, ruleCompliance: (x.ruleCompliance as boolean | null | undefined) ?? null,
    executionQuality: (x.executionQuality as number | null | undefined) ?? null, confidence: (x.confidence as number | null | undefined) ?? null,
    hesitation: String(x.hesitation ?? ''), fomo: String(x.fomo ?? ''), notes: String(x.notes ?? ''),
  } };
}
