import type { ConvergenceInput, RegimeResult } from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x / 10));
}

// Step A: Normalize macro indicators to 0-100.

function normalizeGdp(v: number | null): number {
  if (v === null) return 50;
  return round(clamp((v + 2) * (100 / 8), 0, 100), 1);
}

function normalizeUnemployment(v: number | null): number {
  if (v === null) return 50;
  return round(clamp((10 - v) * (100 / 7), 0, 100), 1);
}

function normalizeNfp(v: number | null): number {
  if (v === null) return 50;
  return round(clamp((v + 200) * (100 / 700), 0, 100), 1);
}

function normalizeConsumerConfidence(v: number | null): number {
  if (v === null) return 50;
  return round(clamp((v - 60) * (100 / 80), 0, 100), 1);
}

function normalizeCpiYoy(v: number | null): number {
  if (v === null) return 50;
  return round(clamp(v * 10, 0, 100), 1);
}

function normalizeCpiMom(v: number | null): number {
  if (v === null) return 50;
  return round(clamp((v + 0.5) * (100 / 1.5), 0, 100), 1);
}

function normalizeFedFunds(v: number | null): number {
  if (v === null) return 50;
  return round(clamp(v * (100 / 8), 0, 100), 1);
}

function normalizeTreasury10y(v: number | null): number {
  if (v === null) return 50;
  return round(clamp(v * (100 / 8), 0, 100), 1);
}

interface SignalResult {
  score: number;
  sub_scores: Record<string, number>;
}

function computeGrowthSignal(input: ConvergenceInput): SignalResult {
  const m = input.fredMacro;
  const gdpScore = normalizeGdp(m.gdp);
  const unempScore = normalizeUnemployment(m.unemployment);
  const nfpScore = normalizeNfp(m.nonfarmPayrolls);
  const ccScore = normalizeConsumerConfidence(m.consumerConfidence);

  const score = round(
    0.3 * gdpScore +
      0.25 * unempScore +
      0.25 * nfpScore +
      0.2 * ccScore,
    1,
  );

  return {
    score,
    sub_scores: {
      gdp_score: gdpScore,
      unemployment_score: unempScore,
      nfp_score: nfpScore,
      consumer_confidence_score: ccScore,
    },
  };
}

function computeInflationSignal(input: ConvergenceInput): SignalResult {
  const m = input.fredMacro;
  const cpiYoyScore = normalizeCpiYoy(m.cpi);
  const cpiMomScore = normalizeCpiMom(m.cpiMom ?? null);
  const fedFundsScore = normalizeFedFunds(m.fedFunds);
  const t10yScore = normalizeTreasury10y(m.treasury10y);

  const score = round(
    0.4 * cpiYoyScore +
      0.3 * cpiMomScore +
      0.15 * fedFundsScore +
      0.15 * t10yScore,
    1,
  );

  return {
    score,
    sub_scores: {
      cpi_yoy_score: cpiYoyScore,
      cpi_mom_score: cpiMomScore,
      fed_funds_score: fedFundsScore,
      treasury_10y_score: t10yScore,
    },
  };
}

interface RegimeClassification {
  probabilities: {
    goldilocks: number;
    reflation: number;
    stagflation: number;
    deflation: number;
  };
  dominant: string;
}

function classifyRegime(growth: number, inflation: number): RegimeClassification {
  const rawGold = sigmoid(growth - 60) * sigmoid(40 - inflation);
  const rawRefl = sigmoid(growth - 60) * sigmoid(inflation - 60);
  const rawStag = sigmoid(40 - growth) * sigmoid(inflation - 60);
  const rawDefl = sigmoid(40 - growth) * sigmoid(40 - inflation);

  const total = rawGold + rawRefl + rawStag + rawDefl;

  const probabilities = {
    goldilocks: round(rawGold / total, 4),
    reflation: round(rawRefl / total, 4),
    stagflation: round(rawStag / total, 4),
    deflation: round(rawDefl / total, 4),
  };

  const entries = Object.entries(probabilities) as [string, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const dominant = entries[0][0].toUpperCase();

  return { probabilities, dominant };
}

function computeBaseRegimeScore(probabilities: {
  goldilocks: number;
  reflation: number;
  stagflation: number;
  deflation: number;
}): number {
  // Stock-bias baseline:
  // Goldilocks/Reflation support long momentum and stronger risk appetite.
  // Stagflation/Deflation lower expected trend quality.
  return round(
    probabilities.goldilocks * 82 +
      probabilities.reflation * 70 +
      probabilities.stagflation * 42 +
      probabilities.deflation * 35,
    1,
  );
}

function vixOverlay(vix: number | null): { type: string; adjustment: number } {
  if (vix === null) return { type: 'UNKNOWN', adjustment: 0 };
  if (vix > 30) return { type: 'HIGH_FEAR', adjustment: -10 };
  if (vix < 15) return { type: 'COMPLACENT', adjustment: 5 };
  return { type: 'NEUTRAL', adjustment: 0 };
}

export function scoreRegime(input: ConvergenceInput): RegimeResult {
  const macro = input.fredMacro;

  const growth = computeGrowthSignal(input);
  const inflation = computeInflationSignal(input);

  const { probabilities, dominant } = classifyRegime(growth.score, inflation.score);

  const baseScore = computeBaseRegimeScore(probabilities);
  const overlay = vixOverlay(macro.vix);
  const vixAdjusted = clamp(round(baseScore + overlay.adjustment, 1), 0, 100);

  // Scale macro impact by SPY correlation.
  const corrSpy = input.scanner?.corrSpy ?? null;
  let score: number;
  let multiplier: number;
  let modifierNote: string;

  if (corrSpy != null) {
    multiplier = round(0.5 + 0.5 * corrSpy, 4);
    score = round(vixAdjusted * multiplier, 1);
    modifierNote = `corrSpy=${corrSpy} -> multiplier=${multiplier} -> ${vixAdjusted} * ${multiplier} = ${score}`;
  } else {
    multiplier = 1;
    score = vixAdjusted;
    modifierNote = 'spy_correlation unavailable -> using vix-adjusted regime score';
  }

  return {
    score,
    breakdown: {
      growth_signal: {
        score: growth.score,
        sub_scores: {
          gdp_score: growth.sub_scores.gdp_score,
          unemployment_score: growth.sub_scores.unemployment_score,
          nfp_score: growth.sub_scores.nfp_score,
          consumer_confidence_score: growth.sub_scores.consumer_confidence_score,
        },
        raw_values: {
          gdp: macro.gdp,
          unemployment: macro.unemployment,
          nfp: macro.nonfarmPayrolls,
          consumer_confidence: macro.consumerConfidence,
        },
      },
      inflation_signal: {
        score: inflation.score,
        sub_scores: {
          cpi_yoy_score: inflation.sub_scores.cpi_yoy_score,
          cpi_mom_score: inflation.sub_scores.cpi_mom_score,
          fed_funds_score: inflation.sub_scores.fed_funds_score,
          treasury_10y_score: inflation.sub_scores.treasury_10y_score,
        },
        raw_values: {
          cpi_yoy: macro.cpi,
          cpi_mom: macro.cpiMom,
          fed_funds: macro.fedFunds,
          treasury_10y: macro.treasury10y,
        },
      },
      regime_probabilities: probabilities,
      dominant_regime: dominant,
      vix_overlay: {
        vix: macro.vix,
        adjustment_type: overlay.type,
        adjustment: overlay.adjustment,
        base_regime_score: baseScore,
      },
      spy_correlation_modifier: {
        corr_spy: corrSpy,
        multiplier,
        base_regime_score: vixAdjusted,
        adjusted_regime_score: score,
        formula: 'adjusted_regime = vix_adjusted_regime * (0.5 + 0.5 * corrSpy)',
        note: modifierNote,
      },
    },
  };
}
