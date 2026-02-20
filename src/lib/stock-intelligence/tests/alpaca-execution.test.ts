import test from 'node:test';
import assert from 'node:assert/strict';
import type { TradeCard } from '../types';
import { executeAlpacaPaperTrades } from '../execution/alpaca';

function actionableCard(ticker: string): TradeCard {
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

test('alpaca executor is disabled by default', async () => {
  const report = await executeAlpacaPaperTrades({
    cards: [actionableCard('AAPL')],
    mode: 'refresh',
    env: {},
    deps: { fetch: globalThis.fetch },
  });
  assert.equal(report.enabled, false);
  assert.equal(report.placed.length, 0);
});

test('alpaca executor places an order with mocked transport', async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const mockFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url.includes('/v2/positions')) {
      return new Response('[]', { status: 200 });
    }
    if (url.includes('/v2/orders?status=open')) {
      return new Response('[]', { status: 200 });
    }
    if (url.endsWith('/v2/orders')) {
      return new Response(JSON.stringify({ id: 'order-1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const report = await executeAlpacaPaperTrades({
    cards: [actionableCard('AAPL')],
    mode: 'refresh',
    env: {
      ALPACA_PAPER_TRADING_ENABLED: 'true',
      ALPACA_API_KEY: 'k',
      ALPACA_API_SECRET: 's',
      ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
      ALPACA_EXECUTE_ON: 'refresh',
      ALPACA_NOTIONAL_USD: '1000',
      ALPACA_MAX_ORDERS_PER_RUN: '2',
    },
    deps: { fetch: mockFetch },
  });

  assert.equal(report.placed.length, 1);
  assert.equal(report.errors.length, 0);
  assert.ok(calls.some((c) => c.url.endsWith('/v2/orders') && c.method === 'POST'));
});
