import { thresholdSettingsByRegime } from './defaults';
import { mean, percentile, stdDev } from './math';
import type { AdaptiveThresholdResult, MarketRegime } from './types';

export function computeAdaptiveThreshold(
  scores: number[],
  regime: MarketRegime,
): AdaptiveThresholdResult {
  const sorted = [...scores].sort((a, b) => a - b);
  const settings = thresholdSettingsByRegime(regime);
  const p = percentile(sorted, settings.percentile);
  const adaptive = Math.max(settings.floor, p);
  return {
    threshold: adaptive,
    percentileTarget: settings.percentile,
    floor: settings.floor,
    mean: mean(scores),
    std: stdDev(scores),
  };
}

