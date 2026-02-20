import type { EngineConfig, MarketRegime } from './types';

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minDollarVolume20d: 10_000_000,
  earningsBlackoutTradingDays: 2,
  earningsUnknownConfidencePenalty: 8,
  universeTargetSize: 500,
  shortlistTargetMin: 5,
  shortlistTargetMax: 10,
  selectionPoolMultiplier: 4,
  expansionEnabled: true,
  expansionBufferPoints: 6,
  pillarCutoff: 60,
  pillarWeights: {
    volEdge: 0.35,
    quality: 0.2,
    regime: 0.25,
    infoEdge: 0.2,
  },
  confidenceBuckets: {
    elite: 90,
    high: 80,
    moderate: 70,
  },
};

export const PROVIDER_TTL_MS = {
  dailyCandles: 24 * 60 * 60 * 1000,
  intraday15m: 10 * 60 * 1000,
  fundamentals: 7 * 24 * 60 * 60 * 1000,
  earnings: 24 * 60 * 60 * 1000,
  news: 3 * 60 * 60 * 1000,
  macro: 24 * 60 * 60 * 1000,
};

export function thresholdSettingsByRegime(regime: MarketRegime): {
  percentile: number;
  floor: number;
} {
  if (regime === 'WEAK') return { percentile: 92, floor: 80 };
  if (regime === 'STRONG') return { percentile: 85, floor: 70 };
  return { percentile: 90, floor: 75 };
}
