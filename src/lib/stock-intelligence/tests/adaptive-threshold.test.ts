import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAdaptiveThreshold } from '../threshold';

const scores = [48, 52, 57, 60, 63, 66, 70, 73, 77, 80, 84, 88, 91];

test('adaptive threshold is strictest in WEAK regime', () => {
  const weak = computeAdaptiveThreshold(scores, 'WEAK');
  const neutral = computeAdaptiveThreshold(scores, 'NEUTRAL');
  const strong = computeAdaptiveThreshold(scores, 'STRONG');
  assert.ok(weak.threshold >= neutral.threshold);
  assert.ok(neutral.threshold >= strong.threshold);
  assert.equal(weak.floor, 80);
  assert.equal(strong.floor, 70);
});

test('adaptive threshold is capped below top score', () => {
  const lowScores = [32, 38, 41, 44];
  const weak = computeAdaptiveThreshold(lowScores, 'WEAK');
  assert.equal(weak.threshold, 43);
});
