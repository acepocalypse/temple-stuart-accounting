import { PROVIDER_TTL_MS } from '../defaults';
import type { Candle } from '../types';
import { fetchCachedJson } from './http';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toYahooSymbol(symbol: string): string {
  if (symbol === 'BRKB') return 'BRK-B';
  if (symbol === 'BFB') return 'BF-B';
  return symbol.replace(/\./g, '-');
}

function fromYahooSymbol(symbol: string): string {
  if (symbol === 'BRK-B') return 'BRKB';
  if (symbol === 'BF-B') return 'BFB';
  return symbol.toUpperCase();
}

function parseCandles(raw: unknown): Candle[] {
  const json = raw as Record<string, unknown>;
  const chart = (json.chart || {}) as Record<string, unknown>;
  const first = ((chart.result || []) as Record<string, unknown>[])[0];
  if (!first) return [];
  const timestamps = (first.timestamp || []) as number[];
  const quote = (((first.indicators || {}) as Record<string, unknown>).quote || []) as Record<
    string,
    unknown
  >[];
  const q = quote[0];
  if (!q) return [];
  const opens = (q.open || []) as unknown[];
  const highs = (q.high || []) as unknown[];
  const lows = (q.low || []) as unknown[];
  const closes = (q.close || []) as unknown[];
  const volumes = (q.volume || []) as unknown[];

  const out: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = Number(timestamps[i]) * 1000;
    const open = parseNumber(opens[i]);
    const high = parseNumber(highs[i]);
    const low = parseNumber(lows[i]);
    const close = parseNumber(closes[i]);
    const volume = parseNumber(volumes[i]) ?? 0;
    if (!open || !high || !low || !close) continue;
    out.push({
      time: t,
      date: new Date(t).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: Math.max(0, volume),
    });
  }
  out.sort((a, b) => a.time - b.time);
  const dedup = new Map<number, Candle>();
  for (const c of out) dedup.set(c.time, c);
  return [...dedup.values()];
}

export async function fetchYahooCandles(
  symbol: string,
  range: '1y' | '6mo' | '3mo' | '1mo',
  interval: '1d' | '15m',
): Promise<{ symbol: string; candles: Candle[]; error: string | null; source: 'network' | 'cache' | 'none' }> {
  const mapped = toYahooSymbol(symbol.toUpperCase());
  const url =
    `${YAHOO_BASE}/${encodeURIComponent(mapped)}` +
    `?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
  const ttlMs = interval === '1d' ? PROVIDER_TTL_MS.dailyCandles : PROVIDER_TTL_MS.intraday15m;
  const result = await fetchCachedJson({
    provider: 'yahoo',
    key: `${mapped}:${range}:${interval}`,
    url,
    ttlMs,
  });
  if (result.error || !result.data) {
    return {
      symbol: fromYahooSymbol(mapped),
      candles: [],
      error: result.error || 'empty response',
      source: result.source,
    };
  }
  return {
    symbol: fromYahooSymbol(mapped),
    candles: parseCandles(result.data),
    error: null,
    source: result.source,
  };
}

