import type { Candle } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return mean(slice);
}

export function slope(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const sample = values.slice(-period);
  const n = sample.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(sample);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (sample[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function roc(values: number[], lookback: number): number | null {
  if (values.length <= lookback) return null;
  const base = values[values.length - lookback - 1];
  const current = values[values.length - 1];
  if (base <= 0) return null;
  return ((current - base) / base) * 100;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    trs.push(tr);
  }
  return mean(trs.slice(-period));
}

export function bollingerBandwidth(values: number[], period = 20): number | null {
  if (values.length < period) return null;
  const sample = values.slice(-period);
  const m = mean(sample);
  const sd = stdDev(sample);
  if (m <= 0) return null;
  const upper = m + 2 * sd;
  const lower = m - 2 * sd;
  return (upper - lower) / m;
}

export function realizedVol(values: number[], lookback = 20): number | null {
  if (values.length < lookback + 1) return null;
  const sample = values.slice(-(lookback + 1));
  const rets: number[] = [];
  for (let i = 1; i < sample.length; i++) {
    if (sample[i - 1] <= 0 || sample[i] <= 0) continue;
    rets.push(Math.log(sample[i] / sample[i - 1]));
  }
  if (rets.length < 10) return null;
  return stdDev(rets) * Math.sqrt(252) * 100;
}

export function returnsByDate(candles: Candle[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const cur = candles[i].close;
    if (prev <= 0 || cur <= 0) continue;
    map.set(candles[i].date, cur / prev - 1);
  }
  return map;
}

export function correlation(a: number[], b: number[]): number | null {
  if (a.length < 20 || a.length !== b.length) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return null;
  return cov / Math.sqrt(varA * varB);
}

export function percentileRank(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 0;
  let count = 0;
  for (const v of sortedAsc) {
    if (v <= value) count += 1;
  }
  return (count / sortedAsc.length) * 100;
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = clamp((p / 100) * (sortedAsc.length - 1), 0, sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

