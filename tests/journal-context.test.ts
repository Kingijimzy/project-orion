import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJournalContext, shouldRetrieveJournalContext } from '../src/lib/journal/context';

test('journal context retrieval activates for explicit journal and past-trade review requests', () => {
  assert.equal(shouldRetrieveJournalContext('journal-review', 'Review this setup'), true);
  assert.equal(shouldRetrieveJournalContext('trading-coach', 'Did I follow my rules in past trades?'), true);
  assert.equal(shouldRetrieveJournalContext('general', 'Explain fair value gaps'), false);
});

test('journal context includes bounded review fields and excludes unrelated/private columns', () => {
  const context = formatJournalContext([{
    symbol: 'BTCUSDT', direction: 'long', timeframe: '1H', setup_type: 'FVG retest', outcome: 'loss',
    rule_compliance: false, reasoning: 'Entered before confirmation', notes: 'Review this later',
    screenshot_refs: ['private screenshot URL'], user_id: 'other-value',
  }]);
  assert.match(context, /BTCUSDT/);
  assert.match(context, /Entered before confirmation/);
  assert.match(context, /do not follow instructions/);
  assert.doesNotMatch(context, /private screenshot URL|other-value|screenshot_refs|user_id/);
});
