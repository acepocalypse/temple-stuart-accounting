import type { Candle, StockFeatures } from './types';
import {
  atr,
  bollingerBandwidth,
  correlation,
  percentileRank,
  realizedVol,
  returnsByDate,
  roc,
  rsi,
  slope,
  sma,
} from './math';

function latest(candles: Candle[]): Candle | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1];
}

function avgVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const sample = candles.slice(-period);
  return sample.reduce((sum, c) => sum + c.volume, 0) / period;
}

function hhhlProxy(candles: Candle[]): boolean {
  if (candles.length < 15) return false;
  const sample = candles.slice(-12);
  const highs = sample.map((c) => c.high);
  const lows = sample.map((c) => c.low);
  const firstHigh = Math.max(...highs.slice(0, 6));
  const lastHigh = Math.max(...highs.slice(6));
  const firstLow = Math.min(...lows.slice(0, 6));
  const lastLow = Math.min(...lows.slice(6));
  return lastHigh >= firstHigh && lastLow >= firstLow;
}

function bbWidthRankish(candles: Candle[]): number | null {
  if (candles.length < 80) return null;
  const closes = candles.map((c) => c.close);
  const widths: number[] = [];
  for (let i = 20; i <= closes.length; i++) {
    const w = bollingerBandwidth(closes.slice(0, i), 20);
    if (w !== null) widths.push(w);
  }
  if (widths.length < 20) return null;
  const current = widths[widths.length - 1];
  const sorted = [...widths].sort((a, b) => a - b);
  return percentileRank(sorted, current);
}

export function buildStockFeatures(args: {
  ticker: string;
  dailyCandles: Candle[];
  spyCandles: Candle[];
  fundamentals: StockFeatures['fundamentals'];
  earnings: StockFeatures['earnings'];
  news: StockFeatures['news'];
}): StockFeatures | null {
  const last = latest(args.dailyCandles);
  if (!last) return null;
  const closes = args.dailyCandles.map((c) => c.close);
  const v20 = avgVolume(args.dailyCandles, 20);
  if (v20 === null || v20 <= 0 || last.close <= 0) return null;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atr14 = atr(args.dailyCandles, 14);
  const rv20 = realizedVol(closes, 20);
  const width = bollingerBandwidth(closes, 20);
  const roc20 = roc(closes, 20);
  const rsi14 = rsi(closes, 14);

  const symReturns = returnsByDate(args.dailyCandles);
  const spyReturns = returnsByDate(args.spyCandles);
  const dates = [...symReturns.keys()]
    .filter((d) => spyReturns.has(d))
    .sort((a, b) => a.localeCompare(b))
    .slice(-60);
  const x: number[] = [];
  const y: number[] = [];
  for (const d of dates) {
    const sx = symReturns.get(d);
    const sy = spyReturns.get(d);
    if (sx === undefined || sy === undefined) continue;
    x.push(sx);
    y.push(sy);
  }
  const corr = correlation(x, y);
  const beta =
    corr === null
      ? null
      : (() => {
          if (x.length < 2 || y.length < 2) return null;
          const meanX = x.reduce((sum, v) => sum + v, 0) / x.length;
          const meanSpy = y.reduce((sum, v) => sum + v, 0) / Math.max(1, y.length);
          const varianceSpy =
            y.reduce((sum, v) => sum + Math.pow(v - meanSpy, 2), 0) /
            Math.max(1, y.length - 1);
          if (varianceSpy <= 0) return null;
          const cov =
            x.reduce((sum, v, i) => sum + (v - meanX) * (y[i] - meanSpy), 0) /
            Math.max(1, x.length - 1);
          return cov / varianceSpy;
        })();

  const slope50 = slope(closes, 50);
  const volumeVs20d = last.volume / v20;
  return {
    ticker: args.ticker,
    price: last.close,
    sector: args.fundamentals.sector,
    dollarVolume20d: v20 * last.close,
    volumeVs20d,
    priceAbove20dma: sma20 !== null && last.close > sma20,
    priceAbove50dma: sma50 !== null && last.close > sma50,
    priceAbove200dma: sma200 !== null && last.close > sma200,
    slope50dma: slope50 ?? 0,
    higherHighHigherLow: hhhlProxy(args.dailyCandles),
    rsi14,
    roc20,
    atr14Pct: atr14 === null ? null : (atr14 / last.close) * 100,
    realizedVol20d: rv20,
    bbWidth: width,
    bbWidthPctRankish: bbWidthRankish(args.dailyCandles),
    breakoutVolume: volumeVs20d >= 1.8,
    spyCorrelation60d: corr,
    betaProxy60d: beta,
    fundamentals: args.fundamentals,
    earnings: args.earnings,
    news: args.news,
  };
}

export function prior15mSwingHigh(intradayCandles: Candle[]): number | null {
  if (intradayCandles.length < 6) return null;
  const sample = intradayCandles.slice(-6, -1);
  if (sample.length === 0) return null;
  return Math.max(...sample.map((c) => c.high));
}
