import type {
  ConvergenceInput,
  VolEdgeResult,
  QualityGateResult,
  RegimeResult,
  InfoEdgeResult,
  CompositeResult,
} from './types';
import { scoreVolEdge } from './vol-edge';
import { scoreQualityGate } from './quality-gate';
import { scoreRegime } from './regime';
import { scoreInfoEdge } from './info-edge';

function round(v: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

export interface FullScoringResult {
  vol_edge: VolEdgeResult;
  quality: QualityGateResult;
  regime: RegimeResult;
  info_edge: InfoEdgeResult;
  composite: CompositeResult;
  data_gaps: string[];
}

export function scoreAll(input: ConvergenceInput): FullScoringResult {
  const volEdge = scoreVolEdge(input);
  const quality = scoreQualityGate(input);
  const regime = scoreRegime(input);
  const infoEdge = scoreInfoEdge(input);

  const compositeScore = round(
    0.25 * volEdge.score +
      0.25 * quality.score +
      0.25 * regime.score +
      0.25 * infoEdge.score,
    1,
  );

  const scores = [volEdge.score, quality.score, regime.score, infoEdge.score];
  const above50 = scores.filter((s) => s > 50).length;

  let convergenceGate: string;
  if (above50 === 4) {
    convergenceGate = '4/4 above 50 -> 100% position size';
  } else if (above50 === 3) {
    convergenceGate = '3/4 above 50 -> 60% position size';
  } else if (above50 === 2) {
    convergenceGate = '2/4 above 50 -> 30% position size';
  } else {
    convergenceGate = `${above50}/4 above 50 -> NO TRADE (convergence too weak)`;
  }

  let direction: string;
  if (infoEdge.score > 65) direction = 'BULLISH';
  else if (infoEdge.score < 35) direction = 'BEARISH';
  else direction = 'NEUTRAL';

  const composite: CompositeResult = {
    score: compositeScore,
    rank_method: 'equal_weighted_percentile_rank',
    note: 'Single ticker mode uses raw 0-100 category scores.',
    convergence_gate: convergenceGate,
    direction,
    category_scores: {
      vol_edge: volEdge.score,
      quality: quality.score,
      regime: regime.score,
      info_edge: infoEdge.score,
    },
    categories_above_50: above50,
  };

  const dataGaps = computeDataGaps(input, quality);

  return {
    vol_edge: volEdge,
    quality,
    regime,
    info_edge: infoEdge,
    composite,
    data_gaps: dataGaps,
  };
}

function computeDataGaps(input: ConvergenceInput, quality: QualityGateResult): string[] {
  const gaps: string[] = [];

  if (!input.sectorStats || Object.keys(input.sectorStats).length === 0) {
    gaps.push('sector_z_scores: requires peer data');
  }

  const piotroski = quality.breakdown.safety.piotroski;
  const missing = 9 - piotroski.available_signals;
  if (missing > 0) {
    gaps.push(
      `piotroski_f_score: ${piotroski.available_signals}/9 signals computable, ${missing} missing annual financial data`,
    );
  }

  const altmanZ = quality.breakdown.safety.altman_z;
  if (altmanZ.components_available < altmanZ.components_total) {
    const altmanMissing = altmanZ.components_total - altmanZ.components_available;
    gaps.push(
      `altman_z: ${altmanZ.components_available}/${altmanZ.components_total} components computable, ${altmanMissing} missing Finnhub fields${altmanZ.capped ? ' (capped: Z < 1.8)' : ''}`,
    );
  }

  if (!input.scanner) {
    gaps.push('stock_scanner: no scanner data returned');
  }

  if (input.candles.length < 50) {
    gaps.push(`candle_technicals: only ${input.candles.length} candles (need 50+)`);
  }

  if (input.finnhubInsiderSentiment.length === 0) {
    gaps.push('insider_sentiment: no data returned');
  }

  if (input.finnhubEarnings.length === 0) {
    gaps.push('earnings_history: no data returned');
  }

  const fred = input.fredMacro;
  const fredMissing: string[] = [];
  if (fred.vix === null) fredMissing.push('VIX');
  if (fred.treasury10y === null) fredMissing.push('10Y');
  if (fred.fedFunds === null) fredMissing.push('FedFunds');
  if (fredMissing.length > 0) {
    gaps.push(`fred_macro: missing ${fredMissing.join(', ')}`);
  }

  return gaps;
}
