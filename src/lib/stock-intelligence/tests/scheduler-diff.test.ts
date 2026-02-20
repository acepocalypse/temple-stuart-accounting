import test from 'node:test';
import assert from 'node:assert/strict';
import { diffActionable } from '../notify/diff';

test('actionable diff detects added/removed/updated', () => {
  const previous = [
    { ticker: 'AAPL', score: 70, triggerPrice: 190 },
    { ticker: 'MSFT', score: 72, triggerPrice: 410 },
  ];
  const current = [
    { ticker: 'AAPL', score: 71, triggerPrice: 191 },
    { ticker: 'NVDA', score: 85, triggerPrice: 900 },
  ];
  const diff = diffActionable(previous, current);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.updated.length, 1);
  assert.equal(diff.hasChanges, true);
});
