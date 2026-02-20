import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerWorker } from '../scheduler/worker';
import type { DailyScanResult, RefreshResult, TradeCard } from '../types';
import { DEFAULT_SCHEDULER_STATE } from '../notify/state';

function makeCard(ticker: string): TradeCard {
  return {
    ticker,
    sector: 'Technology',
    liquidityRank: 1,
    status: 'ACTIONABLE',
    price: 100,
    regime: 'NEUTRAL',
    pillars: { volEdge: 70, quality: 70, regime: 70, infoEdge: 70 },
    overallScore: 70,
    adaptiveThreshold: 65,
    percentileRank: 90,
    convergence: { met: true, pillarsAboveCutoff: 4, cutoff: 60, strength: 'STRONG' },
    confidence: { score: 80, label: 'HIGH' },
    plainEnglish: 'x',
    why: ['x'],
    riskWarnings: [],
    plan: {
      strategy: 'BREAK_ABOVE_PRIOR_15M_SWING_HIGH',
      triggerDescription: 'x',
      triggerPrice: 101,
      stopDescription: 'x',
      stopPrice: 99,
      status: 'ACTIONABLE',
      volumeConfirmed: true,
      atr14: 1,
      distanceTo20dmaPct: 1,
      daily20dma: 99,
      recent15mSwingHigh: 101,
      recent15mSwingLow: 99,
      entryTo20dmaDistancePct: 1,
      riskPerShare: 2,
      oneR: 103,
      twoR: 105,
    },
    blocked: false,
    blockedReason: null,
    freshness: {
      daily: null,
      intraday15m: null,
      fundamentals: null,
      earnings: null,
      macro: null,
      news: null,
    },
    generatedAt: '2026-02-20T14:30:00.000Z',
  };
}

function dailyResult(cards: TradeCard[]): DailyScanResult {
  return {
    generatedAt: '2026-02-20T14:30:00.000Z',
    regime: {
      regime: 'NEUTRAL',
      score: 50,
      spyAbove200dma: true,
      vix: 18,
      ratesTrendUp: null,
      inflationTrendDown: null,
      unemploymentTrendDown: null,
    },
    summary: {
      scannerSymbols: 500,
      filteredByPriceLiquidity: 250,
      scoredUniverse: 50,
      threshold: 70,
      shortlisted: 8,
      returnedCards: cards.length,
      noSetups: cards.length === 0,
    },
    scan_debug: {
      regime_label: 'NEUTRAL',
      adaptive_threshold: 70,
      universe_count: 500,
      valid_daily_count: 500,
      valid_15m_count: 50,
      blocked_earnings_count: 0,
      earnings_unknown_count: 0,
      convergence_pass_count: 20,
      threshold_pass_count: 10,
      top10_scores: [],
    },
    cards,
    watchlist: [],
    diagnostics: {
      errors: [],
      fetchGaps: [],
      providerFailures: [],
      runtimeMs: 1,
    },
  };
}

function refreshResult(cards: TradeCard[]): RefreshResult {
  return {
    generatedAt: '2026-02-20T14:30:00.000Z',
    summary: {
      sourceDailyScanAt: '2026-02-20T14:30:00.000Z',
      refreshedSymbols: 10,
      returnedCards: cards.length,
    },
    cards,
    watchlist: [],
    diagnostics: {
      errors: [],
      fetchGaps: [],
      providerFailures: [],
      runtimeMs: 1,
    },
  };
}

test('scheduler tick runs daily+refresh once per slot/day and notifies on actionable changes', async () => {
  let dailyCalls = 0;
  let refreshCalls = 0;
  let notifyCalls = 0;
  let saved = { ...DEFAULT_SCHEDULER_STATE };

  const worker = new SchedulerWorker(
    {
      enabled: true,
      userKey: 'manual-stock-user',
      timeZone: 'America/New_York',
      windowStartEt: '04:00',
      windowEndEt: '16:00',
      dailyScanTimeEt: '09:20',
      refreshMinutes: 15,
      fallbackRescanMinutes: 60,
      fallbackPoolMin: 5,
      statePath: '/tmp/stock-state.json',
      appUrl: null,
    },
    {
      now: () => new Date('2026-02-20T14:30:00.000Z'),
      runDaily: async () => {
        dailyCalls += 1;
        return dailyResult([makeCard('AAPL')]);
      },
      runRefresh: async () => {
        refreshCalls += 1;
        return refreshResult([makeCard('AAPL')]);
      },
      notify: async () => {
        notifyCalls += 1;
      },
      executeTrades: async () => ({
        placed: [],
        skipped: [],
        errors: [],
      }),
      loadState: async () => ({ ...DEFAULT_SCHEDULER_STATE }),
      saveState: async (_path, state) => {
        saved = state;
      },
      log: () => {},
    },
  );

  await worker.init();
  await worker.tick();
  await worker.tick();

  assert.equal(dailyCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.ok(notifyCalls >= 1);
  assert.equal(saved.lastDailyRunMarketDate, '2026-02-20');
  assert.ok(saved.lastRefreshSlotKey);
});
