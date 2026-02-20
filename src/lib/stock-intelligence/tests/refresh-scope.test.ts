import test from 'node:test';
import assert from 'node:assert/strict';
import { runDailyScan, runIntradayRefresh, testables } from '../engine';
import type { Candle } from '../types';

function makeDaily(start = 20): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < 260; i++) {
    px += 0.08;
    out.push({
      time: i,
      date: `2025-${String((Math.floor(i / 21) % 12) + 1).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`,
      open: px - 0.2,
      high: px + 0.4,
      low: px - 0.5,
      close: px,
      volume: 2_000_000,
    });
  }
  return out;
}

function makeIntraday(start = 30): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < 40; i++) {
    px += 0.04;
    out.push({
      time: i,
      date: '2026-02-18',
      open: px - 0.08,
      high: px + 0.12,
      low: px - 0.12,
      close: px,
      volume: 50_000,
    });
  }
  return out;
}

test('intraday refresh fetches 15m only for shortlist/open symbols', async () => {
  testables._cache.clear();
  const calls: string[] = [];
  const deps = {
    async fetchDailyCandles(symbol: string) {
      return { symbol, candles: makeDaily(symbol === 'SPY' ? 400 : 20), error: null, source: 'network' as const };
    },
    async fetchIntradayCandles(symbol: string) {
      calls.push(symbol);
      return { symbol, candles: makeIntraday(), error: null, source: 'network' as const };
    },
    async fetchFundamentals() {
      return {
        data: {
          sector: 'Technology',
          marketCap: 5000,
          pe: 18,
          eps: 2.5,
          roe: 12,
          currentRatio: 1.6,
          debtToEquity: 70,
          operatingMargin: 18,
        },
        error: null,
        freshness: null,
      };
    },
    async fetchEarnings() {
      return {
        data: { date: '2026-03-12', tradingDaysAway: 15, inBlackoutWindow: false, isUnknown: false },
        error: null,
        freshness: null,
      };
    },
    async fetchNewsSnapshot() {
      return {
        data: {
          sentimentDirection: 'IMPROVING' as const,
          intensityRatio: 1.4,
          divergence: false,
          headlineCount7d: 10,
          headlineCountBaseline: 8,
        },
        error: null,
        freshness: null,
      };
    },
    async fetchMacroSnapshot() {
      return {
        data: {
          regime: 'STRONG' as const,
          score: 70,
          spyAbove200dma: true,
          vix: 16,
          ratesTrendUp: false,
          inflationTrendDown: true,
          unemploymentTrendDown: true,
        },
        error: null,
        freshness: null,
      };
    },
  };

  await runDailyScan(
    'refresh-scope-user',
    true,
    { universeTargetSize: 8, shortlistTargetMax: 2 },
    deps,
  );
  const intradayCallsAfterDaily = calls.length;
  const refreshed = await runIntradayRefresh('refresh-scope-user', true, undefined, deps);
  const intradayCallsInRefresh = calls.length - intradayCallsAfterDaily;
  assert.equal(intradayCallsInRefresh, refreshed.summary.refreshedSymbols);
  assert.ok(intradayCallsInRefresh <= 8);
});
