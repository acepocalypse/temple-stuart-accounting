import type { CandleData } from '@/lib/convergence/types';

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function round(v: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return round(slice.reduce((sum, v) => sum + v, 0) / period, 4);
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) {
    out = values[i] * k + out * (1 - k);
  }
  return round(out, 4);
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    changes.push(values[i] - values[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const c = changes[i];
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 2);
}

export function atr(candles: CandleData[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trs.push(tr);
  }

  let out = trs.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    out = (out * (period - 1) + trs[i]) / period;
  }
  return round(out, 4);
}

export function bollinger(values: number[], period = 20, width = 2): { upper: number | null; lower: number | null } {
  if (values.length < period) return { upper: null, lower: null };
  const slice = values.slice(-period);
  const mean = slice.reduce((sum, v) => sum + v, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, period - 1);
  const sd = Math.sqrt(variance);
  return {
    upper: round(mean + width * sd, 4),
    lower: round(mean - width * sd, 4),
  };
}

export function parseDxEventSymbol(eventSymbol: string): string {
  return eventSymbol.replace(/\{.*\}$/, '');
}
