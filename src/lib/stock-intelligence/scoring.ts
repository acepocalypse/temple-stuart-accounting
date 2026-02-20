import { clamp, round } from './math';
import type { MacroSnapshot, PillarScores, StockFeatures } from './types';

function boolScore(v: boolean, yes = 100, no = 0): number {
  return v ? yes : no;
}

export function scoreVolEdge(features: StockFeatures): number {
  let score = 0;
  score += boolScore(features.priceAbove20dma, 20, 0);
  score += boolScore(features.priceAbove50dma, 20, 0);
  score += boolScore(features.priceAbove200dma, 18, 0);
  score += features.higherHighHigherLow ? 12 : 0;
  score += features.slope50dma > 0 ? 10 : 0;
  if (features.atr14Pct !== null) {
    if (features.atr14Pct >= 1.3 && features.atr14Pct <= 4.5) score += 10;
    else if (features.atr14Pct > 6) score -= 8;
  }
  if (features.bbWidthPctRankish !== null) {
    if (features.bbWidthPctRankish <= 35) score += 8;
    if (features.bbWidthPctRankish > 85) score -= 5;
  }
  if (features.breakoutVolume) score += 7;
  return round(clamp(score, 0, 100), 2);
}

export function scoreQuality(features: StockFeatures): number {
  const f = features.fundamentals;
  let score = 50;
  if (f.marketCap !== null && f.marketCap > 2_000) score += 10;
  if (f.pe !== null && f.pe > 0 && f.pe < 35) score += 8;
  if (f.eps !== null && f.eps > 0) score += 10;
  if (f.roe !== null && f.roe > 8) score += 8;
  if (f.currentRatio !== null && f.currentRatio >= 1.1) score += 7;
  if (f.debtToEquity !== null && f.debtToEquity <= 120) score += 7;
  if (f.operatingMargin !== null && f.operatingMargin > 0) score += 8;
  if (f.eps !== null && f.eps <= 0) score -= 15;
  return round(clamp(score, 0, 100), 2);
}

export function scoreRegime(features: StockFeatures, macro: MacroSnapshot): number {
  let score = macro.score;
  if (features.spyCorrelation60d !== null) {
    const absCorr = Math.abs(features.spyCorrelation60d);
    const alignmentWeight = 0.4 + 0.6 * absCorr;
    score = 50 + (score - 50) * alignmentWeight;
  }
  if (features.priceAbove200dma && macro.regime === 'STRONG') score += 6;
  if (!features.priceAbove50dma && macro.regime === 'WEAK') score -= 8;
  return round(clamp(score, 0, 100), 2);
}

export function scoreInfoEdge(features: StockFeatures): number {
  const news = features.news;
  let score = 50;
  if (news.sentimentDirection === 'IMPROVING') score += 20;
  if (news.sentimentDirection === 'DETERIORATING') score -= 20;
  if (news.intensityRatio > 1.2) score += 8;
  if (news.intensityRatio > 2.2) score += 6;
  if (news.divergence) score -= 15;
  return round(clamp(score, 0, 100), 2);
}

export function scorePillars(features: StockFeatures, macro: MacroSnapshot): PillarScores {
  return {
    volEdge: scoreVolEdge(features),
    quality: scoreQuality(features),
    regime: scoreRegime(features, macro),
    infoEdge: scoreInfoEdge(features),
  };
}

export function overallScore(
  pillars: PillarScores,
  weights: {
    volEdge: number;
    quality: number;
    regime: number;
    infoEdge: number;
  },
): number {
  const sum =
    pillars.volEdge * weights.volEdge +
    pillars.quality * weights.quality +
    pillars.regime * weights.regime +
    pillars.infoEdge * weights.infoEdge;
  return round(clamp(sum, 0, 100), 2);
}

