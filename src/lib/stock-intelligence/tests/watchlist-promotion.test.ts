import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listManualPromotions,
  promoteWatchlistTicker,
  runDailyScan,
  runIntradayRefresh,
  testables,
} from '../engine';
import type { Candle } from '../types';

function makeDaily(symbol = 'AAA'): { symbol: string; candles: Candle[]; error: null; source: 'network' } {
  const out: Candle[] = [];
  let px = symbol === 'SPY' ? 400 : 30;
  for (let i = 0; i < 260; i++) {
    px += 0.08;
    out.push({
      time: i,
      date: `2025-${String((Math.floor(i / 21) % 12) + 1).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`,
      open: px - 0.2,
      high: px + 0.35,
      low: px - 0.35,
      close: px,
      volume: 2_500_000,
    });
  }
  return { symbol, candles: out, error: null, source: 'network' };
}

function makeIntraday(symbol: string): { symbol: string; candles: Candle[]; error: null; source: 'network' } {
  const out: Candle[] = [];
  let px = 40;
  for (let i = 0; i < 32; i++) {
    px += 0.04;
    out.push({
      time: i,
      date: '2026-02-19',
      open: px - 0.05,
      high: px + 0.09,
      low: px - 0.08,
      close: px,
      volume: 100_000 + i * 1_500,
    });
  }
  return { symbol, candles: out, error: null, source: 'network' };
}

function makeDeps(withPlan: boolean) {
  return {
    async fetchDailyCandles(symbol: string) {
      return makeDaily(symbol);
    },
    async fetchIntradayCandles(symbol: string) {
      if (!withPlan) {
        return { symbol, candles: [], error: null, source: 'network' as const };
      }
      return makeIntraday(symbol);
    },
    async fetchFundamentals() {
      return {
        data: {
          sector: 'Technology',
          marketCap: 5_000,
          pe: 20,
          eps: 2.4,
          roe: 12,
          currentRatio: 1.6,
          debtToEquity: 65,
          operatingMargin: 15,
        },
        error: null,
        freshness: null,
      };
    },
    async fetchEarnings() {
      return {
        data: { date: '2026-03-20', tradingDaysAway: 1, inBlackoutWindow: true, isUnknown: false },
        error: null,
        freshness: null,
      };
    },
    async fetchNewsSnapshot() {
      return {
        data: {
          sentimentDirection: 'IMPROVING' as const,
          intensityRatio: 1.2,
          divergence: false,
          headlineCount7d: 8,
          headlineCountBaseline: 7,
        },
        error: null,
        freshness: null,
      };
    },
    async fetchMacroSnapshot() {
      return {
        data: {
          regime: 'NEUTRAL' as const,
          score: 55,
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
}

test('manual promotion moves watchlist ticker to actionable and persists through refresh', async () => {
  testables._cache.clear();
  const user = 'promotion-user';
  const deps = makeDeps(true);
  const config = {
    universeTargetSize: 24,
    shortlistTargetMax: 5,
    expansionEnabled: true,
    expansionBufferPoints: 15,
  };

  const daily = await runDailyScan(user, true, config, deps);
  const candidate = daily.watchlist.find((c) => c.plan);
  assert.ok(candidate, 'expected at least one promotable watchlist ticker');

  const promoted = promoteWatchlistTicker(candidate.ticker, user);
  const promotedCard = promoted.cards.find((c) => c.ticker === candidate.ticker);
  assert.ok(promotedCard, 'promoted ticker should be in actionable cards');
  assert.equal(promotedCard?.manuallyPromoted, true);

  const refreshed = await runIntradayRefresh(user, true, config, deps);
  const refreshedCard = refreshed.cards.find((c) => c.ticker === candidate.ticker);
  assert.ok(refreshedCard, 'promoted ticker should persist in refresh cards');
  assert.equal(refreshedCard?.manuallyPromoted, true);

  await runDailyScan(user, true, config, deps);
  const afterReset = listManualPromotions(user);
  assert.equal(afterReset.tickers.length, 0);
});

test('promotion rejects watchlist ticker without a valid plan', async () => {
  testables._cache.clear();
  const user = 'promotion-no-plan-user';
  const deps = makeDeps(false);
  const config = {
    universeTargetSize: 18,
    shortlistTargetMax: 5,
    expansionEnabled: true,
    expansionBufferPoints: 15,
  };

  const daily = await runDailyScan(user, true, config, deps);
  const candidate = daily.watchlist.find((c) => !c.plan);
  assert.ok(candidate, 'expected at least one watchlist item without a plan');

  assert.throws(
    () => promoteWatchlistTicker(candidate.ticker, user),
    /cannot be promoted without a valid trade plan/i,
  );
});
