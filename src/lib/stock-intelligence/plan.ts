import { round } from './math';
import type { Candle, TradePlan } from './types';
import { prior15mSwingHigh } from './features';

function recentSwingLow(candles: Candle[]): number | null {
  if (candles.length < 6) return null;
  return Math.min(...candles.slice(-6).map((c) => c.low));
}

function recentSwingHigh(candles: Candle[]): number | null {
  if (candles.length < 6) return null;
  return Math.max(...candles.slice(-6).map((c) => c.high));
}

function sma20(dailyCandles: Candle[]): number | null {
  if (dailyCandles.length < 20) return null;
  const sample = dailyCandles.slice(-20);
  return sample.reduce((sum, c) => sum + c.close, 0) / 20;
}

function atr14(dailyCandles: Candle[]): number | null {
  if (dailyCandles.length < 15) return null;
  const trs: number[] = [];
  for (let i = dailyCandles.length - 14; i < dailyCandles.length; i++) {
    const cur = dailyCandles[i];
    const prev = dailyCandles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.reduce((sum, v) => sum + v, 0) / trs.length;
}

function avgVolume(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const sample = candles.slice(-period);
  return sample.reduce((sum, c) => sum + c.volume, 0) / period;
}

export function buildTriggerPlan(args: {
  intraday15m: Candle[];
  dailyCandles: Candle[];
  allowEntry: boolean;
  watchReason: string | null;
  mode?: 'DAILY' | 'INTRADAY';
}): TradePlan | null {
  const mode = args.mode || 'INTRADAY';
  const trigger = prior15mSwingHigh(args.intraday15m);
  const swingLow15m = recentSwingLow(args.intraday15m);
  const swingHigh15m = recentSwingHigh(args.intraday15m);
  const dailySma20 = sma20(args.dailyCandles);
  const dailyAtr14 = atr14(args.dailyCandles);
  const lastBar = args.intraday15m[args.intraday15m.length - 1];
  const prevBar = args.intraday15m[args.intraday15m.length - 2];
  const avgVol20 = avgVolume(args.intraday15m, 20);

  if (!lastBar || !prevBar || trigger === null || swingLow15m === null) return null;

  const triggerPrice = round(trigger + 0.01, 2);
  const stopCandidates: number[] = [];
  stopCandidates.push(swingLow15m - 0.01);
  if (dailySma20 !== null) stopCandidates.push(dailySma20 - 0.01);
  if (dailyAtr14 !== null) stopCandidates.push(triggerPrice - dailyAtr14 * 1.2);
  const stopPrice = round(Math.min(...stopCandidates), 2);
  const riskPerShare = round(triggerPrice - stopPrice, 2);
  if (riskPerShare <= 0) return null;

  const volumeConfirmed =
    lastBar.volume > prevBar.volume &&
    (avgVol20 === null ? true : lastBar.volume >= avgVol20);
  const aboveDaily20 = dailySma20 === null ? true : triggerPrice > dailySma20;
  const actionable =
    mode === 'INTRADAY'
      ? args.allowEntry && volumeConfirmed && aboveDaily20
      : args.allowEntry && aboveDaily20;

  const oneR = round(triggerPrice + riskPerShare, 2);
  const twoR = round(triggerPrice + riskPerShare * 2, 2);
  const distanceTo20dmaPct =
    dailySma20 === null ? null : round(((triggerPrice - dailySma20) / dailySma20) * 100, 2);
  const stopDescription =
    stopPrice <= swingLow15m
      ? 'Stop below recent 15m swing low.'
      : dailySma20 !== null && stopPrice <= dailySma20
        ? 'Stop below daily 20DMA.'
        : 'Stop at 1.2x ATR(14) below trigger.';

  return {
    strategy: 'BREAK_ABOVE_PRIOR_15M_SWING_HIGH',
    triggerDescription: actionable
      ? mode === 'INTRADAY'
        ? 'Breakout above prior 15m swing high with volume confirmation.'
        : 'Planned trigger for next session: break above prior 15m swing high and confirm volume live.'
      : args.watchReason || 'Trigger present but confirmation conditions are not fully met.',
    triggerPrice,
    stopDescription,
    stopPrice,
    status: actionable ? 'ACTIONABLE' : 'WATCH_ONLY',
    volumeConfirmed,
    atr14: dailyAtr14 === null ? null : round(dailyAtr14, 2),
    distanceTo20dmaPct,
    daily20dma: dailySma20 === null ? null : round(dailySma20, 2),
    recent15mSwingHigh: swingHigh15m === null ? null : round(swingHigh15m, 2),
    recent15mSwingLow: round(swingLow15m, 2),
    entryTo20dmaDistancePct: distanceTo20dmaPct,
    riskPerShare,
    oneR,
    twoR,
  };
}

export function gapRiskProxy(dailyCandles: Candle[]): number {
  if (dailyCandles.length < 30) return 0;
  let gapDays = 0;
  const sample = dailyCandles.slice(-30);
  for (let i = 1; i < sample.length; i++) {
    const prevClose = sample[i - 1].close;
    const open = sample[i].open;
    const gapPct = Math.abs((open - prevClose) / prevClose) * 100;
    if (gapPct >= 2.2) gapDays += 1;
  }
  return round((gapDays / 29) * 100, 2);
}
