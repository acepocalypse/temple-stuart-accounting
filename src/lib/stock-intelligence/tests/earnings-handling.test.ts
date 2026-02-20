import test from 'node:test';
import assert from 'node:assert/strict';
import { runDailyScan, testables } from '../engine';
import type { Candle } from '../types';

function makeDaily(symbol = 'AAA'): { symbol: string; candles: Candle[]; error: null; source: 'network' } {
  const out: Candle[] = [];
  let px = symbol === 'SPY' ? 400 : 30;
  for (let i = 0; i < 260; i++) {
    px += 0.1;
    out.push({
      time: i,
      date: `2025-${String((Math.floor(i / 21) % 12) + 1).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`,
      open: px - 0.2,
      high: px + 0.3,
      low: px - 0.4,
      close: px,
      volume: 2_500_000,
    });
  }
  return { symbol, candles: out, error: null, source: 'network' };
}

function makeIntraday(symbol: string): { symbol: string; candles: Candle[]; error: null; source: 'network' } {
  const out: Candle[] = [];
  let px = 40;
  for (let i = 0; i < 30; i++) {
    px += 0.05;
    out.push({
      time: i,
      date: '2026-02-19',
      open: px - 0.03,
      high: px + 0.07,
      low: px - 0.07,
      close: px,
      volume: 90000 + i * 2000,
    });
  }
  return { symbol, candles: out, error: null, source: 'network' };
}

test('earnings near date forces WATCH_ONLY; unknown date does not hard-block', async () => {
  testables._cache.clear();
  const symbols = ['SPY', '^VIX', 'AAPL', 'MSFT', 'NVDA', 'AMD'];
  const deps = {
    async fetchDailyCandles(symbol: string) {
      if (!symbols.includes(symbol)) return makeDaily(symbol);
      return makeDaily(symbol);
    },
    async fetchIntradayCandles(symbol: string) {
      return makeIntraday(symbol);
    },
    async fetchFundamentals() {
      return {
        data: {
          sector: 'Technology',
          marketCap: 5000,
          pe: 20,
          eps: 2.2,
          roe: 10,
          currentRatio: 1.5,
          debtToEquity: 70,
          operatingMargin: 12,
        },
        error: null,
        freshness: null,
      };
    },
    async fetchEarnings(symbol: string) {
      if (symbol === 'A') {
        return {
          data: { date: '2026-02-20', tradingDaysAway: 1, inBlackoutWindow: true, isUnknown: false },
          error: null,
          freshness: null,
        };
      }
      if (symbol === 'AAPL') {
        return {
          data: { date: null, tradingDaysAway: null, inBlackoutWindow: false, isUnknown: true },
          error: null,
          freshness: null,
        };
      }
      return {
        data: { date: '2026-03-15', tradingDaysAway: 15, inBlackoutWindow: false, isUnknown: false },
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
          score: 72,
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

  const result = await runDailyScan('earnings-test', true, { universeTargetSize: 50, expansionEnabled: true, expansionBufferPoints: 15 }, deps);
  const aaa = [...result.cards, ...result.watchlist].find((c) => c.ticker === 'A');
  const bbb = [...result.cards, ...result.watchlist].find((c) => c.ticker === 'AAPL');
  assert.ok(aaa);
  assert.equal(aaa?.status, 'WATCH_ONLY');
  assert.ok(bbb);
  assert.notEqual(bbb?.blockedReason, 'Earnings window too close');
});
