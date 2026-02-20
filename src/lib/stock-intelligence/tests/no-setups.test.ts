import test from 'node:test';
import assert from 'node:assert/strict';
import { runDailyScan, testables } from '../engine';
import type { Candle } from '../types';

const tinyDaily: Candle[] = [
  { time: 1, date: '2026-02-18', open: 10, high: 10.2, low: 9.8, close: 10.1, volume: 1000 },
];

const deps = {
  async fetchDailyCandles() {
    return { symbol: 'X', candles: tinyDaily, error: null, source: 'cache' as const };
  },
  async fetchIntradayCandles() {
    return { symbol: 'X', candles: tinyDaily, error: null, source: 'cache' as const };
  },
  async fetchFundamentals() {
    return {
      data: {
        sector: null,
        marketCap: null,
        pe: null,
        eps: null,
        roe: null,
        currentRatio: null,
        debtToEquity: null,
        operatingMargin: null,
      },
      error: null,
      freshness: null,
    };
  },
  async fetchEarnings() {
    return {
      data: { date: null, tradingDaysAway: null, inBlackoutWindow: false, isUnknown: true },
      error: null,
      freshness: null,
    };
  },
  async fetchNewsSnapshot() {
    return {
      data: {
        sentimentDirection: 'FLAT' as const,
        intensityRatio: 1,
        divergence: false,
        headlineCount7d: 0,
        headlineCountBaseline: 0,
      },
      error: null,
      freshness: null,
    };
  },
  async fetchMacroSnapshot() {
    return {
      data: {
        regime: 'NEUTRAL' as const,
        score: 50,
        spyAbove200dma: true,
        vix: 18,
        ratesTrendUp: null,
        inflationTrendDown: null,
        unemploymentTrendDown: null,
      },
      error: null,
      freshness: null,
    };
  },
};

test('no setups condition returns empty shortlist with reason', async () => {
  testables._cache.clear();
  const result = await runDailyScan(
    'test-user-no-setup',
    true,
    { universeTargetSize: 3 },
    deps,
  );
  assert.equal(result.summary.noSetups, true);
  assert.equal(result.cards.length, 0);
  assert.ok(result.diagnostics.fetchGaps.includes('No high-quality setups today.'));
});
