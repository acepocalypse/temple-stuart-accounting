import { SEED_SYMBOLS } from '@/lib/stocks/symbols';

const ETF_EXCLUSIONS = new Set([
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'VTI',
  'VOO',
  'XLF',
  'XLK',
  'XLE',
  'XLV',
  'XLI',
  'XLY',
  'XLP',
  'XLB',
  'XLU',
  'XLRE',
  'XLC',
]);

export function getSeedUniverse(limit: number): string[] {
  return [...SEED_SYMBOLS]
    .map((s) => s.toUpperCase())
    .filter((s) => !ETF_EXCLUSIONS.has(s))
    .slice(0, limit);
}
