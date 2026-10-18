import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoInstrument, forexInstrument, isTimeframe, resolveInstrument } from '../src/lib/market/instrument';

describe('instrument normalization', () => {
  it('recognises supported forex pairs with or without separators', () => {
    for (const input of ['EURUSD', 'eurusd', 'EUR/USD', 'eur-usd', 'EUR_USD', ' eur/usd ']) {
      const instrument = resolveInstrument(input);
      assert.equal(instrument?.assetClass, 'forex', input);
      assert.equal(instrument?.provider, 'twelve-data', input);
      assert.equal(instrument?.symbol, 'EUR/USD', input);
    }
    assert.equal(resolveInstrument('AUDJPY')?.symbol, 'AUD/JPY');
    assert.equal(resolveInstrument('GBPAUD')?.symbol, 'GBP/AUD');
  });

  it('treats crypto symbols as crypto even when six letters long', () => {
    const btcusd = resolveInstrument('BTCUSD');
    assert.equal(btcusd?.assetClass, 'crypto');
    assert.equal(btcusd?.symbol, 'BTCUSD');
    assert.equal(btcusd?.base, 'BTC');
    assert.equal(btcusd?.quote, 'USD');
    const eth = resolveInstrument('ETH/BTC');
    assert.equal(eth?.assetClass, 'crypto');
    assert.equal(eth?.base, 'ETH');
    assert.equal(eth?.quote, 'BTC');
  });

  it('prefers the longest matching crypto quote and keeps the venue category', () => {
    assert.equal(cryptoInstrument('BTCUSDT').quote, 'USDT');
    assert.equal(cryptoInstrument('BTCUSDC').quote, 'USDC');
    assert.equal(cryptoInstrument('btcusdt', 'spot').category, 'spot');
  });

  it('returns null for empty, malformed, or unrecognisable input', () => {
    assert.equal(resolveInstrument(''), null);
    assert.equal(resolveInstrument('!!!'), null);
    assert.equal(resolveInstrument('a'.repeat(31)), null);
    assert.equal(resolveInstrument('EUR/USD', 'crypto')?.assetClass, 'crypto');
  });

  it('validates canonical timeframes', () => {
    assert.equal(isTimeframe('15m'), true);
    assert.equal(isTimeframe('1min'), false);
    assert.equal(isTimeframe('30'), false);
  });

  it('builds forex descriptors from the pair allowlist', () => {
    assert.deepEqual(forexInstrument('GBP/JPY'), { assetClass: 'forex', provider: 'twelve-data', symbol: 'GBP/JPY', displaySymbol: 'GBP/JPY', base: 'GBP', quote: 'JPY' });
  });
});
