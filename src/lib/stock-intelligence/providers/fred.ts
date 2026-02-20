import { PROVIDER_TTL_MS } from '../defaults';
import type { MacroSnapshot, MarketRegime } from '../types';
import { fetchCachedJson } from './http';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

function fredKey(): string | null {
  const key = process.env.FRED_API_KEY;
  if (!key || !key.trim()) return null;
  return key.trim();
}

function parseObservations(raw: unknown): number[] {
  const payload = raw as Record<string, unknown>;
  const observations = (payload.observations || []) as Record<string, unknown>[];
  return observations
    .map((o) => Number(o.value))
    .filter((v) => Number.isFinite(v))
    .slice(-6);
}

function trend(values: number[]): boolean | null {
  if (values.length < 3) return null;
  const half = Math.floor(values.length / 2);
  const early =
    values.slice(0, half).reduce((sum, v) => sum + v, 0) / Math.max(1, half);
  const late =
    values.slice(half).reduce((sum, v) => sum + v, 0) /
    Math.max(1, values.length - half);
  return late > early;
}

async function fetchSeries(seriesId: string, apiKey: string): Promise<number[]> {
  const url =
    `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=asc`;
  const response = await fetchCachedJson({
    provider: 'fred',
    key: `series:${seriesId}`,
    url,
    ttlMs: PROVIDER_TTL_MS.macro,
  });
  if (!response.data) return [];
  return parseObservations(response.data);
}

function deriveRegime(args: {
  spyAbove200dma: boolean;
  vix: number | null;
  ratesTrendUp: boolean | null;
  inflationTrendDown: boolean | null;
  unemploymentTrendDown: boolean | null;
}): { regime: MarketRegime; score: number } {
  let score = 50;
  score += args.spyAbove200dma ? 20 : -20;
  if (args.vix !== null) {
    if (args.vix < 18) score += 12;
    else if (args.vix > 28) score -= 18;
  }
  if (args.ratesTrendUp === true) score -= 6;
  if (args.ratesTrendUp === false) score += 4;
  if (args.inflationTrendDown === true) score += 8;
  if (args.inflationTrendDown === false) score -= 8;
  if (args.unemploymentTrendDown === true) score += 6;
  if (args.unemploymentTrendDown === false) score -= 6;
  if (score >= 64) return { regime: 'STRONG', score };
  if (score <= 42) return { regime: 'WEAK', score };
  return { regime: 'NEUTRAL', score };
}

export async function fetchMacroSnapshot(
  spyAbove200dma: boolean,
  vix: number | null,
): Promise<{ data: MacroSnapshot; error: string | null; freshness: string | null }> {
  const apiKey = fredKey();
  if (!apiKey) {
    const fallback = deriveRegime({
      spyAbove200dma,
      vix,
      ratesTrendUp: null,
      inflationTrendDown: null,
      unemploymentTrendDown: null,
    });
    return {
      data: {
        regime: fallback.regime,
        score: fallback.score,
        spyAbove200dma,
        vix,
        ratesTrendUp: null,
        inflationTrendDown: null,
        unemploymentTrendDown: null,
      },
      error: 'FRED_API_KEY missing',
      freshness: null,
    };
  }

  const [dgs10, cpi, unrate] = await Promise.all([
    fetchSeries('DGS10', apiKey),
    fetchSeries('CPIAUCSL', apiKey),
    fetchSeries('UNRATE', apiKey),
  ]);
  const ratesTrendUp = trend(dgs10);
  const inflationTrendUp = trend(cpi);
  const unemploymentTrendUp = trend(unrate);
  const regime = deriveRegime({
    spyAbove200dma,
    vix,
    ratesTrendUp,
    inflationTrendDown: inflationTrendUp === null ? null : !inflationTrendUp,
    unemploymentTrendDown: unemploymentTrendUp === null ? null : !unemploymentTrendUp,
  });

  return {
    data: {
      regime: regime.regime,
      score: regime.score,
      spyAbove200dma,
      vix,
      ratesTrendUp,
      inflationTrendDown: inflationTrendUp === null ? null : !inflationTrendUp,
      unemploymentTrendDown: unemploymentTrendUp === null ? null : !unemploymentTrendUp,
    },
    error: null,
    freshness: new Date().toISOString(),
  };
}

