/**
 * User-authored trading rules and a deterministic check of a journal entry against them.
 * Structured rules are machine-checkable from a recorded entry. Free-form notes are surfaced
 * as "manual" items that require the user's own judgement — the code never invents a verdict.
 */
export type TradingRuleDirection = 'long' | 'short';

export type TradingRules = {
  requireStopLoss: boolean;
  requireTarget: boolean;
  maxStopDistancePct: number | null;
  minRewardRisk: number | null;
  allowedSymbols: string[];
  allowedTimeframes: string[];
  allowedDirections: TradingRuleDirection[];
  notes: string;
};

export const EMPTY_TRADING_RULES: TradingRules = {
  requireStopLoss: false, requireTarget: false, maxStopDistancePct: null, minRewardRisk: null,
  allowedSymbols: [], allowedTimeframes: [], allowedDirections: [], notes: '',
};

export function validateTradingRules(value: unknown): { ok: true; rules: TradingRules } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Rules must be an object.' };
  const x = value as Record<string, unknown>;
  for (const key of ['requireStopLoss', 'requireTarget'] as const) if (x[key] !== undefined && typeof x[key] !== 'boolean') return { ok: false, error: `${key} must be true or false.` };
  const nullableNumber = (key: string, max: number): number | null | string => {
    const raw = x[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > max) return `${key} must be a positive number up to ${max}, or left blank.`;
    return raw;
  };
  const maxStop = nullableNumber('maxStopDistancePct', 50);
  if (typeof maxStop === 'string') return { ok: false, error: maxStop };
  const minRR = nullableNumber('minRewardRisk', 100);
  if (typeof minRR === 'string') return { ok: false, error: minRR };
  const symbols = x.allowedSymbols ?? [];
  const normalizeSymbol = (s: unknown) => (typeof s === 'string' ? s.replace(/[\s/-]/g, '').toUpperCase() : '');
  if (!Array.isArray(symbols) || symbols.length > 50 || symbols.some((s) => !/^[A-Z0-9]{2,30}$/.test(normalizeSymbol(s)))) return { ok: false, error: 'Allowed symbols must be up to 50 instruments, each 2–30 letters or digits.' };
  const timeframes = x.allowedTimeframes ?? [];
  if (!Array.isArray(timeframes) || timeframes.length > 20 || timeframes.some((t) => typeof t !== 'string' || !t.trim() || t.trim().length > 12)) return { ok: false, error: 'Allowed timeframes must be up to 20 labels, each up to 12 characters.' };
  const directions = x.allowedDirections ?? [];
  if (!Array.isArray(directions) || directions.length > 2 || directions.some((d) => d !== 'long' && d !== 'short')) return { ok: false, error: 'Allowed directions must be long, short, or empty for both.' };
  if (x.notes !== undefined && (typeof x.notes !== 'string' || x.notes.length > 4000)) return { ok: false, error: 'Rule notes must be text up to 4000 characters.' };
  const unique = <T,>(items: T[]): T[] => Array.from(new Set(items));
  return { ok: true, rules: {
    requireStopLoss: x.requireStopLoss === true, requireTarget: x.requireTarget === true,
    maxStopDistancePct: maxStop, minRewardRisk: minRR,
    allowedSymbols: unique(symbols.map(normalizeSymbol)),
    allowedTimeframes: unique(timeframes.map((t) => (t as string).trim())),
    allowedDirections: unique(directions as TradingRuleDirection[]),
    notes: typeof x.notes === 'string' ? x.notes.trim() : '',
  } };
}

export type RuleCheckStatus = 'pass' | 'fail' | 'not-applicable' | 'manual';
export type RuleCheck = { rule: string; status: RuleCheckStatus; detail: string };
export type RuleCheckableEntry = { symbol: string; direction: string; timeframe: string; entry: number; stop_loss: number | null; target: number | null };

const round = (n: number) => Math.round(n * 100) / 100;

/** Deterministic check. A rule is only failed when the recorded entry actually violates it; missing data is reported as not-applicable, never as a guess. */
export function checkEntryAgainstRules(entry: RuleCheckableEntry, rules: TradingRules): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const hasStop = typeof entry.stop_loss === 'number' && Number.isFinite(entry.stop_loss) && entry.stop_loss > 0;
  const hasTarget = typeof entry.target === 'number' && Number.isFinite(entry.target) && entry.target > 0;
  const validEntry = Number.isFinite(entry.entry) && entry.entry > 0;
  const direction = entry.direction === 'short' ? 'short' : 'long';

  if (rules.requireStopLoss) checks.push(hasStop
    ? { rule: 'Every trade must have a stop loss', status: 'pass', detail: `Stop recorded at ${entry.stop_loss}.` }
    : { rule: 'Every trade must have a stop loss', status: 'fail', detail: 'No stop loss is recorded on this entry.' });
  if (rules.requireTarget) checks.push(hasTarget
    ? { rule: 'Every trade must have a target', status: 'pass', detail: `Target recorded at ${entry.target}.` }
    : { rule: 'Every trade must have a target', status: 'fail', detail: 'No target is recorded on this entry.' });

  if (rules.maxStopDistancePct !== null) {
    if (!hasStop || !validEntry) checks.push({ rule: `Stop distance must be within ${rules.maxStopDistancePct}%`, status: 'not-applicable', detail: 'Record an entry and stop to check stop distance.' });
    else { const pct = round((Math.abs(entry.entry - (entry.stop_loss as number)) / entry.entry) * 100); checks.push(pct <= rules.maxStopDistancePct
      ? { rule: `Stop distance must be within ${rules.maxStopDistancePct}%`, status: 'pass', detail: `Stop sits ${pct}% from entry.` }
      : { rule: `Stop distance must be within ${rules.maxStopDistancePct}%`, status: 'fail', detail: `Stop sits ${pct}% from entry, beyond the limit.` }); }
  }
  if (rules.minRewardRisk !== null) {
    if (!hasStop || !hasTarget || !validEntry) checks.push({ rule: `Reward:risk must be at least ${rules.minRewardRisk}R`, status: 'not-applicable', detail: 'Record an entry, stop, and target to check reward:risk.' });
    else {
      const risk = Math.abs(entry.entry - (entry.stop_loss as number));
      const reward = direction === 'long' ? (entry.target as number) - entry.entry : entry.entry - (entry.target as number);
      if (risk <= 0 || reward <= 0) checks.push({ rule: `Reward:risk must be at least ${rules.minRewardRisk}R`, status: 'fail', detail: 'The stop or target is on the wrong side of the entry for this direction.' });
      else { const rr = round(reward / risk); checks.push(rr >= rules.minRewardRisk
        ? { rule: `Reward:risk must be at least ${rules.minRewardRisk}R`, status: 'pass', detail: `Reward:risk is ${rr}R.` }
        : { rule: `Reward:risk must be at least ${rules.minRewardRisk}R`, status: 'fail', detail: `Reward:risk is ${rr}R, below the minimum.` }); }
    }
  }
  const entrySymbol = entry.symbol.replace(/[\s/-]/g, '').toUpperCase();
  if (rules.allowedSymbols.length > 0) checks.push(rules.allowedSymbols.includes(entrySymbol)
    ? { rule: `Only trade ${rules.allowedSymbols.join(', ')}`, status: 'pass', detail: `${entrySymbol} is on the allowed list.` }
    : { rule: `Only trade ${rules.allowedSymbols.join(', ')}`, status: 'fail', detail: `${entrySymbol} is not on the allowed list.` });
  if (rules.allowedTimeframes.length > 0) { const tf = entry.timeframe.trim(); checks.push(rules.allowedTimeframes.includes(tf)
    ? { rule: `Only use timeframes: ${rules.allowedTimeframes.join(', ')}`, status: 'pass', detail: `${tf} is allowed.` }
    : { rule: `Only use timeframes: ${rules.allowedTimeframes.join(', ')}`, status: 'fail', detail: `${tf} is not on the allowed list.` }); }
  if (rules.allowedDirections.length > 0) checks.push((rules.allowedDirections as string[]).includes(direction)
    ? { rule: `Only take ${rules.allowedDirections.join('/')} trades`, status: 'pass', detail: `This is a ${direction} trade.` }
    : { rule: `Only take ${rules.allowedDirections.join('/')} trades`, status: 'fail', detail: `This is a ${direction} trade, which the rules exclude.` });
  if (rules.notes) checks.push({ rule: 'Rules you described in your own words', status: 'manual', detail: rules.notes });
  return checks;
}

export function describeTradingRules(rules: TradingRules): string[] {
  return [
    rules.requireStopLoss ? 'A stop loss is required on every trade.' : 'A stop loss is optional.',
    rules.requireTarget ? 'A target is required on every trade.' : 'A target is optional.',
    rules.maxStopDistancePct !== null ? `Stop distance must stay within ${rules.maxStopDistancePct}% of entry.` : 'No maximum stop distance.',
    rules.minRewardRisk !== null ? `Reward:risk must be at least ${rules.minRewardRisk}R.` : 'No minimum reward:risk.',
    rules.allowedSymbols.length ? `Allowed instruments: ${rules.allowedSymbols.join(', ')}.` : 'Any instrument is allowed.',
    rules.allowedTimeframes.length ? `Allowed timeframes: ${rules.allowedTimeframes.join(', ')}.` : 'Any timeframe is allowed.',
    rules.allowedDirections.length ? `Allowed directions: ${rules.allowedDirections.join(', ')}.` : 'Both directions are allowed.',
    rules.notes ? `Your own notes: ${rules.notes}` : 'No personal rule notes.',
  ];
}

export function isEmptyTradingRules(rules: TradingRules): boolean {
  return !rules.requireStopLoss && !rules.requireTarget && rules.maxStopDistancePct === null && rules.minRewardRisk === null && rules.allowedSymbols.length === 0 && rules.allowedTimeframes.length === 0 && rules.allowedDirections.length === 0 && !rules.notes;
}

/** Fixed context for chat. The model must not invent compliance for manual rules. */
export function formatTradingRulesContext(rules: TradingRules): string {
  return `[The signed-in user's own trading rules. Treat these as fixed, user-authored facts. Check a trade against them only using the recorded entry fields; for any rule listed under "manual", explain that it needs the user's own judgement and do not state whether it was followed.\n${JSON.stringify({ structured: describeTradingRules(rules).slice(0, 7), manual: rules.notes ? [rules.notes] : [] })}]`;
}

/** Fixed context carrying code-computed rule results. The model must report these verbatim, not re-judge them. */
export function formatRuleCheckContext(entry: RuleCheckableEntry, rules: TradingRules, checks: RuleCheck[]): string {
  return `[Deterministic rule check computed in code for the user's most recent journal entry (${entry.symbol} ${entry.direction} ${entry.timeframe}). Report each result exactly as given: pass means pass and fail means fail. Do not override a result, and do not invent results for manual items — state that those need the user's own judgement.\n${JSON.stringify(checks)}]`;
}
