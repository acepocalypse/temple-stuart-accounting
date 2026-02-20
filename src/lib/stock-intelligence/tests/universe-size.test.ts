import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedUniverse,
  ETF_EXCLUSION_SYMBOLS,
  EXCLUDED_SYMBOLS,
} from '@/lib/stocks/symbols';

test('buildSeedUniverse returns exactly 500 symbols with and without ETF exclusions', () => {
  const withEtf = buildSeedUniverse(500, { excludeEtfs: false });
  const withoutEtf = buildSeedUniverse(500, { excludeEtfs: true });
  assert.equal(withEtf.length, 500);
  assert.equal(withoutEtf.length, 500);
});

test('buildSeedUniverse output is uppercase, unique, and respects exclusions', () => {
  const universe = buildSeedUniverse(500, { excludeEtfs: true });
  assert.equal(new Set(universe).size, universe.length);
  assert.ok(universe.every((s) => s === s.toUpperCase()));

  const excluded = new Set(EXCLUDED_SYMBOLS.map((s) => s.toUpperCase()));
  for (const symbol of universe) {
    assert.equal(excluded.has(symbol), false);
  }

  const etfs = new Set(ETF_EXCLUSION_SYMBOLS.map((s) => s.toUpperCase()));
  for (const symbol of universe) {
    assert.equal(etfs.has(symbol), false);
  }
});
