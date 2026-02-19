import type {
  CandleData,
  ConvergenceInput,
  MispricingTrace,
  TechnicalsTrace,
  TermStructureTrace,
  VolEdgeResult,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function zScore(value: number | null, avg: number, sd: number): number | null {
  if (value === null || sd < 0.001) return null;
  return round((value - avg) / sd, 2);
}

function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function computeSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return round(mean(values.slice(-period)), 2);
}

function computeRSI(candles: CandleData[], period = 14): {
  rsi: number | null;
  avgGain: number;
  avgLoss: number;
  rs: number;
} {
  if (candles.length < period + 1) {
    return { rsi: null, avgGain: 0, avgLoss: 0, rs: 0 };
  }

  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return { rsi: 100, avgGain: round(avgGain, 4), avgLoss: 0, rs: Number.POSITIVE_INFINITY };
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return {
    rsi: round(rsi, 2),
    avgGain: round(avgGain, 4),
    avgLoss: round(avgLoss, 4),
    rs: round(rs, 4),
  };
}

function computeMACD(candles: CandleData[]): {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
} {
  if (candles.length < 35) {
    return { macdLine: null, signalLine: null, histogram: null };
  }
  const closes = candles.map((c) => c.close);
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]).slice(25);
  const signalSeries = computeEMA(macdSeries, 9);
  if (macdSeries.length === 0 || signalSeries.length === 0) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  return {
    macdLine: round(macdLine, 4),
    signalLine: round(signalLine, 4),
    histogram: round(macdLine - signalLine, 4),
  };
}

function computeBollinger(candles: CandleData[], period = 20): {
  upper: number | null;
  lower: number | null;
  middle: number | null;
  position: number | null;
  width: number | null;
} {
  if (candles.length < period) {
    return { upper: null, lower: null, middle: null, position: null, width: null };
  }
  const closes = candles.slice(-period).map((c) => c.close);
  const mid = mean(closes);
  const sd = stddev(closes);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const last = candles[candles.length - 1].close;
  const position = upper !== lower ? (last - lower) / (upper - lower) : null;
  const width = mid > 0 ? (upper - lower) / mid : null;
  return {
    upper: round(upper, 2),
    lower: round(lower, 2),
    middle: round(mid, 2),
    position: position === null ? null : round(position, 4),
    width: width === null ? null : round(width, 4),
  };
}

function scoreMispricing(input: ConvergenceInput): MispricingTrace {
  const scanner = input.scanner;
  const iv30 = scanner?.iv30 ?? null;
  const hv30 = scanner?.hv30 ?? null;
  const hv60 = scanner?.hv60 ?? null;
  const hv90 = scanner?.hv90 ?? null;
  let ivp = scanner?.ivPercentile ?? null;
  if (ivp !== null && ivp <= 1) ivp = round(ivp * 100, 1);
  const ivHvSpread = scanner?.ivHvSpread ?? null;

  let vrp: number | null = null;
  let vrpDesc = 'N/A (missing IV30 or HV30)';
  if (iv30 !== null && hv30 !== null && iv30 > 0) {
    vrp = iv30 ** 2 - hv30 ** 2;
    vrpDesc = `${iv30}^2 - ${hv30}^2 = ${round(vrp, 2)}`;
  }

  const sector = scanner?.sector;
  const metrics = sector ? input.sectorStats?.[sector]?.metrics : undefined;
  const z = {
    vrp_z: zScore(vrp, 0, (metrics?.iv_hv_spread?.std ?? 0) * 100),
    ivp_z: zScore(ivp, metrics?.iv_percentile?.mean ?? 0, metrics?.iv_percentile?.std ?? 0),
    iv_hv_z: zScore(ivHvSpread, metrics?.iv_hv_spread?.mean ?? 0, metrics?.iv_hv_spread?.std ?? 0),
    hv_accel_z: zScore(
      hv30 !== null && hv60 !== null ? hv30 - hv60 : null,
      0,
      metrics?.hv30?.std ?? 0,
    ),
    note: metrics ? `sector z-scores vs ${sector} peers` : 'sector z-scores unavailable',
  };

  let vrpScoreRaw = 50;
  if (iv30 !== null && hv30 !== null && iv30 > 0) {
    const ratio = (iv30 - hv30) / iv30;
    vrpScoreRaw = clamp(50 + ratio * 50, 0, 100);
  }

  const ivpScoreRaw = ivp !== null ? clamp(ivp, 0, 100) : 50;
  const ivHvScoreRaw = ivHvSpread !== null ? clamp((Math.abs(ivHvSpread) / 20) * 100, 0, 100) : 50;

  let hvAccelScoreRaw = 50;
  let hvTrend = 'UNKNOWN (missing HV data)';
  if (hv30 !== null && hv60 !== null && hv90 !== null) {
    if (hv30 < hv60 && hv60 < hv90) {
      hvTrend = `FALLING (${hv30} < ${hv60} < ${hv90})`;
      hvAccelScoreRaw = 80;
    } else if (hv30 < hv60) {
      hvTrend = `DECLINING (${hv30} < ${hv60})`;
      hvAccelScoreRaw = 65;
    } else if (hv30 > hv60 && hv60 > hv90) {
      hvTrend = `RISING (${hv30} > ${hv60} > ${hv90})`;
      hvAccelScoreRaw = 20;
    } else if (hv30 > hv60) {
      hvTrend = `ACCELERATING (${hv30} > ${hv60})`;
      hvAccelScoreRaw = 35;
    } else {
      hvTrend = `FLAT (${hv30}, ${hv60}, ${hv90})`;
      hvAccelScoreRaw = 50;
    }
  }

  const hasZ = z.vrp_z !== null || z.ivp_z !== null || z.iv_hv_z !== null || z.hv_accel_z !== null;
  const vrpScore = z.vrp_z !== null ? round(50 + clamp(z.vrp_z * 15, -50, 50), 1) : vrpScoreRaw;
  const ivpScore = z.ivp_z !== null ? round(50 + clamp(z.ivp_z * 15, -50, 50), 1) : ivpScoreRaw;
  const ivHvScore = z.iv_hv_z !== null ? round(50 + clamp(z.iv_hv_z * 15, -50, 50), 1) : ivHvScoreRaw;
  const hvAccelScore =
    z.hv_accel_z !== null ? round(50 + clamp(z.hv_accel_z * 15, -50, 50), 1) : hvAccelScoreRaw;

  const score = round(0.3 * vrpScore + 0.3 * ivpScore + 0.25 * ivHvScore + 0.15 * hvAccelScore, 1);
  const mode = hasZ ? 'z-score mode' : 'raw mode';

  return {
    score: round(score),
    weight: 0.5,
    inputs: {
      IV_30: iv30,
      HV_30: hv30,
      HV_60: hv60,
      HV_90: hv90,
      IV_percentile: ivp,
      IV_HV_spread: ivHvSpread,
      VRP: vrpDesc,
    },
    formula:
      `0.30xVRP(${round(vrpScore, 1)}) + 0.30xIVP(${round(ivpScore, 1)}) + ` +
      `0.25xIV_HV(${round(ivHvScore, 1)}) + 0.15xHV_accel(${round(hvAccelScore, 1)}) = ${score} (${mode})`,
    notes: `VRP=${round(vrpScore)}, IVP=${round(ivpScore)}, IV_HV=${round(ivHvScore)}, HV_accel=${round(hvAccelScore)}`,
    z_scores: z,
    hv_trend: hvTrend,
  };
}

function scoreTermStructure(input: ConvergenceInput): TermStructureTrace {
  const scanner = input.scanner;
  const ts = scanner?.termStructure ?? [];
  const earningsDate = scanner?.earningsDate ?? null;

  if (ts.length < 2) {
    return {
      score: 50,
      weight: 0.3,
      inputs: { expirations_available: ts.length },
      formula: 'Insufficient term structure (<2 expirations) -> default 50',
      notes: 'Need at least two expirations.',
      shape: 'UNKNOWN',
      richest_tenor: null,
      cheapest_tenor: null,
      optimal_expiration: null,
      expirations_analyzed: ts.length,
      earnings_kink_detected: false,
    };
  }

  const sorted = [...ts].sort((a, b) => a.date.localeCompare(b.date));
  const frontIV = sorted[0].iv;
  const backIV = sorted[sorted.length - 1].iv;
  const slope = frontIV > 0 ? (backIV - frontIV) / frontIV : 0;

  let shape: string;
  let shapeScore: number;
  if (slope > 0.15) {
    shape = 'STEEP_CONTANGO';
    shapeScore = 85;
  } else if (slope > 0.05) {
    shape = 'CONTANGO';
    shapeScore = 70;
  } else if (slope > -0.05) {
    shape = 'FLAT';
    shapeScore = 50;
  } else if (slope > -0.15) {
    shape = 'BACKWARDATION';
    shapeScore = 35;
  } else {
    shape = 'STEEP_BACKWARDATION';
    shapeScore = 20;
  }

  let richest = sorted[0];
  let cheapest = sorted[0];
  for (const row of sorted) {
    if (row.iv > richest.iv) richest = row;
    if (row.iv < cheapest.iv) cheapest = row;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const withDte = sorted.map((r) => ({
    ...r,
    dte: Math.round((new Date(`${r.date}T00:00:00`).getTime() - todayMs) / 86400000),
  }));

  let optimal = withDte.filter((r) => r.dte >= 20 && r.dte <= 90);
  if (optimal.length === 0) optimal = withDte;
  const optimalRow = optimal.reduce((best, r) => (r.iv > best.iv ? r : best), optimal[0]);

  let earningsKinkDetected = false;
  if (earningsDate) {
    const earningsTime = new Date(`${earningsDate}T00:00:00`).getTime();
    for (let i = 0; i < sorted.length; i++) {
      const exp = sorted[i];
      const expTime = new Date(`${exp.date}T00:00:00`).getTime();
      const daysDiff = Math.abs(expTime - earningsTime) / 86400000;
      if (daysDiff > 7) continue;

      const prev = i > 0 ? sorted[i - 1].iv : null;
      const next = i < sorted.length - 1 ? sorted[i + 1].iv : null;
      const neighborAvg = prev !== null && next !== null ? (prev + next) / 2 : prev ?? next ?? 0;
      if (neighborAvg > 0 && exp.iv > neighborAvg * 1.15) {
        earningsKinkDetected = true;
      }
    }
  }

  if (earningsKinkDetected) {
    shapeScore = clamp(shapeScore - 5, 0, 100);
  }

  const richestDte = withDte.find((r) => r.date === richest.date)?.dte ?? null;

  return {
    score: round(shapeScore),
    weight: 0.3,
    inputs: {
      front_month_iv: round(frontIV, 2),
      back_month_iv: round(backIV, 2),
      slope: `${round(slope * 100, 1)}% -> ${shape}`,
      expirations_analyzed: sorted.length,
      earnings_date: earningsDate,
    },
    formula: `slope=${round(slope * 100, 1)}% -> ${shape} -> ${shapeScore}`,
    notes: `${sorted.length} expirations. Richest ${richest.date}, cheapest ${cheapest.date}.`,
    shape,
    richest_tenor: `${richest.date} (${richestDte ?? 'N/A'} DTE, IV=${round(richest.iv, 2)})`,
    cheapest_tenor: `${cheapest.date} (IV=${round(cheapest.iv, 2)})`,
    optimal_expiration: `${optimalRow.date} (${optimalRow.dte} DTE, IV=${round(optimalRow.iv, 3)})`,
    expirations_analyzed: sorted.length,
    earnings_kink_detected: earningsKinkDetected,
  };
}

function scoreTechnicals(input: ConvergenceInput): TechnicalsTrace {
  const candles = input.candles.filter(
    (c) =>
      Number.isFinite(c.open) &&
      c.open > 0 &&
      Number.isFinite(c.high) &&
      c.high > 0 &&
      Number.isFinite(c.low) &&
      c.low > 0 &&
      Number.isFinite(c.close) &&
      c.close > 0 &&
      Number.isFinite(c.volume) &&
      c.volume >= 0,
  );

  if (candles.length < 20) {
    return {
      score: 50,
      weight: 0.2,
      inputs: { candles_available: candles.length },
      formula: `Insufficient candles (${candles.length}) -> default 50`,
      notes: 'Need at least 20 candles.',
      sub_scores: {
        rsi_score: 50,
        trend_score: 50,
        bollinger_score: 50,
        volume_score: 50,
        macd_score: 50,
      },
      indicators: {
        rsi_14: null,
        rsi_trace: null,
        sma_20: null,
        sma_50: null,
        latest_close: null,
        bb_upper: null,
        bb_lower: null,
        bb_middle: null,
        bb_position: null,
        bb_width: null,
        macd_line: null,
        macd_signal: null,
        macd_histogram: null,
        avg_volume_5d: null,
        avg_volume_20d: null,
        volume_ratio: null,
      },
      candles_used: candles.length,
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const latestClose = closes[closes.length - 1];

  const rsiRes = computeRSI(candles, 14);
  let rsiScore = 50;
  if (rsiRes.rsi !== null) {
    rsiScore = clamp(round(100 - 2 * Math.abs(rsiRes.rsi - 50), 1), 0, 100);
  }

  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, 50);
  let trendScore = 50;
  if (sma20 !== null && sma50 !== null) {
    if (latestClose > sma20 && sma20 > sma50) trendScore = 70;
    else if (latestClose > sma50) trendScore = 58;
    else if (latestClose < sma20 && sma20 < sma50) trendScore = 30;
    else trendScore = 42;
  } else if (sma20 !== null) {
    trendScore = latestClose > sma20 ? 60 : 40;
  }

  const bb = computeBollinger(candles, 20);
  let bbScore = 50;
  if (bb.position !== null) {
    bbScore = clamp(round(100 - 100 * Math.abs(bb.position - 0.5) * 2, 1), 0, 100);
  }

  const vol5 = volumes.length >= 5 ? round(mean(volumes.slice(-5))) : null;
  const vol20 = volumes.length >= 20 ? round(mean(volumes.slice(-20))) : null;
  const volRatio = vol5 !== null && vol20 !== null && vol20 > 0 ? round(vol5 / vol20, 4) : null;

  let volumeScore = 50;
  if (volRatio !== null) {
    if (volRatio > 1.5) volumeScore = 70;
    else if (volRatio > 1.2) volumeScore = 62;
    else if (volRatio > 0.8) volumeScore = 55;
    else volumeScore = 40;
  }

  const macd = computeMACD(candles);
  let macdScore = 50;
  if (macd.histogram !== null && latestClose > 0) {
    const normalized = (Math.abs(macd.histogram) / latestClose) * 100;
    if (normalized < 0.5) macdScore = 60;
    else if (normalized < 1.0) macdScore = 50;
    else if (normalized < 2.0) macdScore = 40;
    else macdScore = 30;
  }

  const score = round(
    0.25 * rsiScore +
      0.25 * trendScore +
      0.2 * bbScore +
      0.15 * volumeScore +
      0.15 * macdScore,
    1,
  );

  return {
    score: round(score),
    weight: 0.2,
    inputs: {
      candles_available: candles.length,
      latest_close: round(latestClose, 2),
    },
    formula:
      `0.25xRSI(${round(rsiScore)}) + 0.25xTrend(${round(trendScore)}) + ` +
      `0.20xBB(${round(bbScore)}) + 0.15xVol(${round(volumeScore)}) + 0.15xMACD(${round(macdScore)}) = ${score}`,
    notes: `RSI=${rsiRes.rsi ?? 'N/A'}, SMA20=${sma20 ?? 'N/A'}, SMA50=${sma50 ?? 'N/A'}, BB_pos=${bb.position ?? 'N/A'}`,
    sub_scores: {
      rsi_score: round(rsiScore),
      trend_score: round(trendScore),
      bollinger_score: round(bbScore),
      volume_score: round(volumeScore),
      macd_score: round(macdScore),
    },
    indicators: {
      rsi_14: rsiRes.rsi,
      rsi_trace:
        rsiRes.rsi !== null
          ? { avg_gain: rsiRes.avgGain, avg_loss: rsiRes.avgLoss, rs: rsiRes.rs }
          : null,
      sma_20: sma20,
      sma_50: sma50,
      latest_close: round(latestClose, 2),
      bb_upper: bb.upper,
      bb_lower: bb.lower,
      bb_middle: bb.middle,
      bb_position: bb.position,
      bb_width: bb.width,
      macd_line: macd.macdLine,
      macd_signal: macd.signalLine,
      macd_histogram: macd.histogram,
      avg_volume_5d: vol5,
      avg_volume_20d: vol20,
      volume_ratio: volRatio,
    },
    candles_used: candles.length,
  };
}

export function scoreVolEdge(input: ConvergenceInput): VolEdgeResult {
  const mispricing = scoreMispricing(input);
  const termStructure = scoreTermStructure(input);
  const hasCandles = input.candles.length >= 20;

  let technicals: TechnicalsTrace;
  let score: number;

  if (hasCandles) {
    technicals = scoreTechnicals(input);
    score = round(
      mispricing.weight * mispricing.score +
        termStructure.weight * termStructure.score +
        technicals.weight * technicals.score,
      1,
    );
  } else {
    score = round(0.625 * mispricing.score + 0.375 * termStructure.score, 1);
    technicals = {
      score: 0,
      weight: 0,
      inputs: { candles_available: input.candles.length },
      formula: 'No candle data. Technicals excluded; mispricing and term structure renormalized.',
      notes: 'Technicals excluded due to insufficient candles.',
      sub_scores: {
        rsi_score: 0,
        trend_score: 0,
        bollinger_score: 0,
        volume_score: 0,
        macd_score: 0,
      },
      indicators: {
        rsi_14: null,
        rsi_trace: null,
        sma_20: null,
        sma_50: null,
        latest_close: null,
        bb_upper: null,
        bb_lower: null,
        bb_middle: null,
        bb_position: null,
        bb_width: null,
        macd_line: null,
        macd_signal: null,
        macd_histogram: null,
        avg_volume_5d: null,
        avg_volume_20d: null,
        volume_ratio: null,
      },
      candles_used: 0,
    };
  }

  return {
    score,
    breakdown: {
      mispricing,
      term_structure: termStructure,
      technicals,
    },
  };
}
