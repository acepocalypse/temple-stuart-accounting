import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriggerPlan } from '../plan';
import type { Candle } from '../types';

function makeDaily(): Candle[] {
  const out: Candle[] = [];
  let px = 50;
  for (let i = 0; i < 60; i++) {
    px += 0.2;
    out.push({
      time: i,
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: px - 0.3,
      high: px + 0.4,
      low: px - 0.5,
      close: px,
      volume: 600000,
    });
  }
  return out;
}

function makeIntraday(): Candle[] {
  const out: Candle[] = [];
  let px = 58;
  for (let i = 0; i < 30; i++) {
    px += 0.05;
    out.push({
      time: i,
      date: '2026-02-19',
      open: px - 0.04,
      high: px + 0.08,
      low: px - 0.08,
      close: px,
      volume: i === 29 ? 120000 : 80000 + i * 1000,
    });
  }
  return out;
}

test('trigger plan returns per-share risk fields only', () => {
  const plan = buildTriggerPlan({
    intraday15m: makeIntraday(),
    dailyCandles: makeDaily(),
    allowEntry: true,
    watchReason: null,
  });
  assert.ok(plan);
  if (!plan) return;
  assert.ok(plan.triggerPrice > plan.stopPrice);
  assert.ok(plan.riskPerShare > 0);
  assert.equal(typeof plan.oneR, 'number');
  assert.equal(typeof plan.twoR, 'number');
  assert.equal((plan as unknown as Record<string, unknown>).shares, undefined);
});

