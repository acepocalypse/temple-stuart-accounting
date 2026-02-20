import { buildSeedUniverse } from '@/lib/stocks/symbols';

export function getSeedUniverse(limit: number): string[] {
  return buildSeedUniverse(limit, { excludeEtfs: true });
}
