import { clamp, round } from './math';
import type { ConfidenceResult, EngineConfig, MacroSnapshot, PillarScores } from './types';

export function countPillarsAbove(pillars: PillarScores, cutoff: number): number {
  const values = [pillars.volEdge, pillars.quality, pillars.regime, pillars.infoEdge];
  return values.filter((v) => v >= cutoff).length;
}

export function deriveConfidence(args: {
  pillars: PillarScores;
  overall: number;
  threshold: number;
  macro: MacroSnapshot;
  config: EngineConfig;
  sentimentBonus: number;
}): ConfidenceResult {
  const convergence = countPillarsAbove(args.pillars, args.config.pillarCutoff);
  const convergenceScore = convergence * 18;
  const thresholdDistance = Math.max(0, args.overall - args.threshold) * 1.1;
  const regimeComponent = (args.macro.score - 50) * 0.45;
  const sentiment = args.sentimentBonus * 8;
  const raw = 35 + convergenceScore + thresholdDistance + regimeComponent + sentiment;
  const score = round(clamp(raw, 0, 100), 2);
  let label: ConfidenceResult['label'] = 'WATCH';
  if (score >= args.config.confidenceBuckets.elite) label = 'ELITE';
  else if (score >= args.config.confidenceBuckets.high) label = 'HIGH';
  else if (score >= args.config.confidenceBuckets.moderate) label = 'MODERATE';
  return { score, label };
}

