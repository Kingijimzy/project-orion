import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEntryAgainstRules, describeTradingRules, formatRuleCheckContext, formatTradingRulesContext, isEmptyTradingRules, validateTradingRules, EMPTY_TRADING_RULES, type TradingRules } from '../src/lib/journal/rules';

const rules = (over: Partial<TradingRules> = {}): TradingRules => ({ ...structuredClone(EMPTY_TRADING_RULES), ...over });
const entry = (over: Partial<{ symbol: string; direction: string; timeframe: string; entry: number; stop_loss: number | null; target: number | null }> = {}) =>
  ({ symbol: 'BTCUSDT', direction: 'long', timeframe: '1H', entry: 100, stop_loss: 95, target: 110, ...over });

test('validateTradingRules normalizes and dedupes a rule set', () => {
  const result = validateTradingRules({ requireStopLoss: true, maxStopDistancePct: 3, minRewardRisk: 2, allowedSymbols: ['btcusdt', ' BTCUSDT ', 'EUR/USD'], allowedTimeframes: ['1H', '1H', '4H'], allowedDirections: ['long'], notes: ' no revenge trades ' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rules.allowedSymbols, ['BTCUSDT', 'EURUSD']);
  assert.deepEqual(result.rules.allowedTimeframes, ['1H', '4H']);
  assert.equal(result.rules.notes, 'no revenge trades');
});

test('validateTradingRules rejects out-of-range numbers and malformed lists', () => {
  assert.equal(validateTradingRules({ maxStopDistancePct: 0 }).ok, false);
  assert.equal(validateTradingRules({ maxStopDistancePct: 51 }).ok, false);
  assert.equal(validateTradingRules({ minRewardRisk: -1 }).ok, false);
  assert.equal(validateTradingRules({ allowedDirections: ['sideways'] }).ok, false);
  assert.equal(validateTradingRules({ allowedSymbols: ['A'] }).ok, false);
  assert.equal(validateTradingRules('nope').ok, false);
});

test('a required stop and target fail only when the entry actually omits them', () => {
  const check = checkEntryAgainstRules(entry({ stop_loss: null, target: null }), rules({ requireStopLoss: true, requireTarget: true }));
  assert.deepEqual(check.map((c) => c.status), ['fail', 'fail']);
  const ok = checkEntryAgainstRules(entry(), rules({ requireStopLoss: true, requireTarget: true }));
  assert.deepEqual(ok.map((c) => c.status), ['pass', 'pass']);
});

test('stop distance is checked deterministically and reported as not-applicable when data is missing', () => {
  const fail = checkEntryAgainstRules(entry({ entry: 100, stop_loss: 90 }), rules({ maxStopDistancePct: 5 }));
  assert.equal(fail[0].status, 'fail');
  const pass = checkEntryAgainstRules(entry({ entry: 100, stop_loss: 98 }), rules({ maxStopDistancePct: 5 }));
  assert.equal(pass[0].status, 'pass');
  const na = checkEntryAgainstRules(entry({ stop_loss: null }), rules({ maxStopDistancePct: 5 }));
  assert.equal(na[0].status, 'not-applicable');
});

test('reward:risk uses direction and flags a stop or target on the wrong side', () => {
  assert.equal(checkEntryAgainstRules(entry({ entry: 100, stop_loss: 95, target: 110 }), rules({ minRewardRisk: 2 }))[0].status, 'pass');
  assert.equal(checkEntryAgainstRules(entry({ entry: 100, stop_loss: 95, target: 104 }), rules({ minRewardRisk: 2 }))[0].status, 'fail');
  assert.equal(checkEntryAgainstRules(entry({ direction: 'short', entry: 100, stop_loss: 95, target: 90 }), rules({ minRewardRisk: 2 }))[0].status, 'pass');
  assert.equal(checkEntryAgainstRules(entry({ entry: 100, stop_loss: 105, target: 90 }), rules({ minRewardRisk: 2 }))[0].status, 'fail');
  assert.equal(checkEntryAgainstRules(entry({ target: null }), rules({ minRewardRisk: 2 }))[0].status, 'not-applicable');
});

test('allow-lists fail on an excluded instrument, timeframe, or direction', () => {
  const checks = checkEntryAgainstRules(entry({ symbol: 'ETHUSDT', timeframe: '15m', direction: 'short' }), rules({ allowedSymbols: ['BTCUSDT'], allowedTimeframes: ['1H'], allowedDirections: ['long'] }));
  assert.deepEqual(checks.map((c) => c.status), ['fail', 'fail', 'fail']);
});

test('free-form notes are surfaced as manual, never graded', () => {
  const [check] = checkEntryAgainstRules(entry(), rules({ notes: 'Never add to a losing position.' }));
  assert.equal(check.status, 'manual');
  const context = formatTradingRulesContext(rules({ notes: 'Never add to a losing position.' }));
  assert.match(context, /manual/);
  assert.match(context, /user-authored facts/);
});

test('isEmptyTradingRules distinguishes a blank rule set from a configured one', () => {
  assert.equal(isEmptyTradingRules(EMPTY_TRADING_RULES), true);
  assert.equal(isEmptyTradingRules(rules({ notes: 'anything' })), false);
  assert.equal(isEmptyTradingRules(rules({ requireStopLoss: true })), false);
});

test('the deterministic check context tells the model to report results verbatim', () => {
  const r = rules({ minRewardRisk: 2 });
  const e = entry({ entry: 100, stop_loss: 95, target: 104 });
  const context = formatRuleCheckContext(e, r, checkEntryAgainstRules(e, r));
  assert.match(context, /computed in code/);
  assert.match(context, /Do not override a result/);
  assert.match(context, /"status":"fail"/);
});

test('an empty rule set produces no checks and a plain description', () => {
  assert.deepEqual(checkEntryAgainstRules(entry(), EMPTY_TRADING_RULES), []);
  const described = describeTradingRules(EMPTY_TRADING_RULES);
  assert.equal(described.length, 8);
  assert.match(described.join(' '), /optional/);
});
