import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFallbackTransition,
  shouldActivateFallback,
  shouldRunFallbackRescan,
  type FallbackState,
} from '../scheduler/fallback';

test('fallback activation condition', () => {
  assert.equal(shouldActivateFallback({ returnedCards: 0, shortlisted: 2, poolMin: 5 }), true);
  assert.equal(shouldActivateFallback({ returnedCards: 1, shortlisted: 2, poolMin: 5 }), false);
  assert.equal(shouldActivateFallback({ returnedCards: 0, shortlisted: 5, poolMin: 5 }), false);
});

test('fallback transition enter/exit', () => {
  const now = '2026-02-20T14:00:00.000Z';
  const start: FallbackState = { active: false, enteredAt: null, lastRescanAt: null };
  const entered = applyFallbackTransition(start, { returnedCards: 0, shortlisted: 1, poolMin: 5 }, now);
  assert.equal(entered.entered, true);
  assert.equal(entered.next.active, true);

  const exited = applyFallbackTransition(entered.next, { returnedCards: 2, shortlisted: 6, poolMin: 5 }, now);
  assert.equal(exited.exited, true);
  assert.equal(exited.next.active, false);
});

test('fallback rescan interval logic', () => {
  const base: FallbackState = {
    active: true,
    enteredAt: '2026-02-20T14:00:00.000Z',
    lastRescanAt: '2026-02-20T14:00:00.000Z',
  };
  assert.equal(shouldRunFallbackRescan(Date.parse('2026-02-20T14:30:00.000Z'), base, 60), false);
  assert.equal(shouldRunFallbackRescan(Date.parse('2026-02-20T15:00:00.000Z'), base, 60), true);
});
