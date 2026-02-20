import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMarketDateKey,
  getRefreshSlotKey,
  isWithinMarketWindow,
  shouldRunDailyScanAt,
  shouldRunRefreshAt,
} from '../scheduler/market-window';

test('market window supports premarket + rth boundaries in ET', () => {
  const cfg = {
    timeZone: 'America/New_York',
    windowStartEt: '04:00',
    windowEndEt: '16:00',
  };
  assert.equal(isWithinMarketWindow(new Date('2026-02-20T08:59:00Z'), cfg), false); // 03:59 ET
  assert.equal(isWithinMarketWindow(new Date('2026-02-20T09:00:00Z'), cfg), true); // 04:00 ET
  assert.equal(isWithinMarketWindow(new Date('2026-02-20T21:00:00Z'), cfg), true); // 16:00 ET
  assert.equal(isWithinMarketWindow(new Date('2026-02-20T21:01:00Z'), cfg), false); // 16:01 ET
});

test('daily and refresh scheduling decisions', () => {
  const base = {
    timeZone: 'America/New_York',
    dailyScanTimeEt: '09:20',
    refreshMinutes: 15,
    windowStartEt: '04:00',
    windowEndEt: '16:00',
  };
  const now = new Date('2026-02-20T14:30:00Z'); // 09:30 ET
  const marketDate = getMarketDateKey(now, base.timeZone);
  assert.equal(shouldRunDailyScanAt(now, base, null), true);
  assert.equal(shouldRunDailyScanAt(now, base, marketDate), false);

  const slot = getRefreshSlotKey(now, base);
  assert.equal(shouldRunRefreshAt(now, base, null), true);
  assert.equal(shouldRunRefreshAt(now, base, slot), false);
});
