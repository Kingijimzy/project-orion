import { it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFromMarketData } from '../src/lib/smc/market-analysis';
import type { BybitCategory, BybitInterval, CandleResult, MarketDataService } from '../src/lib/market/bybit';

it('loads four timeframes through MarketDataService and returns structured engine results', async () => {
  const calls: string[] = [];
  const service: MarketDataService = {
    async getCandles(category: BybitCategory, symbol: string, interval: BybitInterval): Promise<CandleResult> {
      calls.push(interval);
      const step = interval === 'D' ? 86_400_000 : Number(interval) * 60_000;
      const candles = Array.from({ length: 12 }, (_, index) => ({ startTime: Date.UTC(2026,0,1) + index * step, open: 100, high: 101, low: 99, close: 100, volume: 1, turnover: 100, closed: true }));
      return { category, symbol, interval, candles, lastUpdated: '2026-01-13T00:00:00.000Z', stale: false, source: 'Bybit V5 public REST' };
    },
    async searchSymbols() { return []; },
  };
  const result = await analyzeFromMarketData(service, { symbol: 'BTCUSDT', category: 'linear', timeframe: '60' }, { now: Date.UTC(2026,0,13), maxDataAgeMs: 10 * 86_400_000, swingLeft: 1, swingRight: 1 });
  assert.deepEqual(calls.sort(), ['240','30','60','D']);
  assert.equal(result.analysis.symbol, 'BTCUSDT');
  assert.equal(result.analysis.structure.timeframe, '60');
  assert.equal(result.source, 'Bybit V5 public REST');
  assert.ok(result.analysis.qualificationRule.includes('close-based'));
});
