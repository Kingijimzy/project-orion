import test from 'node:test';
import assert from 'node:assert/strict';
import { bybitKlineTopic, bybitPublicWebSocketUrl, parseBybitKlineMessage } from '../src/lib/market/bybit-websocket';

test('builds the official public URL and kline topic for each Bybit market category', () => {
  assert.equal(bybitPublicWebSocketUrl('spot'), 'wss://stream.bybit.com/v5/public/spot');
  assert.equal(bybitPublicWebSocketUrl('linear'), 'wss://stream.bybit.com/v5/public/linear');
  assert.equal(bybitPublicWebSocketUrl('inverse'), 'wss://stream.bybit.com/v5/public/inverse');
  assert.equal(bybitKlineTopic('60', 'BTCUSDT'), 'kline.60.BTCUSDT');
});

test('parses forming and confirmed kline updates and rejects malformed messages', () => {
  const topic = 'kline.60.BTCUSDT';
  const base = { start: '1792108800000', interval: '60', open: '100', high: '105', low: '99', close: '103', volume: '2.5', turnover: '257.5' };
  assert.deepEqual(parseBybitKlineMessage({ topic, data: [{ ...base, confirm: false }] }, topic), { startTime: 1792108800000, open: 100, high: 105, low: 99, close: 103, volume: 2.5, turnover: 257.5, closed: false });
  assert.equal(parseBybitKlineMessage({ topic, data: [{ ...base, confirm: true }] }, topic)?.closed, true);
  assert.equal(parseBybitKlineMessage({ topic: 'kline.5.BTCUSDT', data: [{ ...base, confirm: false }] }, topic), null);
  assert.equal(parseBybitKlineMessage({ topic, data: [{ ...base, high: '98', confirm: false }] }, topic), null);
  assert.equal(parseBybitKlineMessage({ topic, data: [{ ...base, confirm: 'false' }] }, topic), null);
});
