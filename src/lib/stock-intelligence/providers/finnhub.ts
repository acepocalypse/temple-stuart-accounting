import { tradingDaysBetween } from '../dates';
import { PROVIDER_TTL_MS } from '../defaults';
import type { EarningsInfo, FundamentalsLite, NewsSnapshot } from '../types';
import { fetchCachedJson } from './http';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function key(): string | null {
  const k = process.env.FINNHUB_API_KEY;
  if (!k || !k.trim()) return null;
  return k.trim();
}

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchFundamentals(symbol: string): Promise<{
  data: FundamentalsLite;
  error: string | null;
  freshness: string | null;
}> {
  const token = key();
  if (!token) {
    return {
      data: {
        sector: null,
        marketCap: null,
        pe: null,
        eps: null,
        roe: null,
        currentRatio: null,
        debtToEquity: null,
        operatingMargin: null,
      },
      error: 'FINNHUB_API_KEY missing',
      freshness: null,
    };
  }
  const profileUrl = `${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${token}`;
  const metricUrl = `${FINNHUB_BASE}/stock/metric?symbol=${symbol}&metric=all&token=${token}`;
  const [profile, metric] = await Promise.all([
    fetchCachedJson({
      provider: 'finnhub',
      key: `profile:${symbol}`,
      url: profileUrl,
      ttlMs: PROVIDER_TTL_MS.fundamentals,
    }),
    fetchCachedJson({
      provider: 'finnhub',
      key: `metric:${symbol}`,
      url: metricUrl,
      ttlMs: PROVIDER_TTL_MS.fundamentals,
    }),
  ]);

  if (!profile.data || !metric.data) {
    return {
      data: {
        sector: null,
        marketCap: null,
        pe: null,
        eps: null,
        roe: null,
        currentRatio: null,
        debtToEquity: null,
        operatingMargin: null,
      },
      error: profile.error || metric.error || 'fundamental fetch failure',
      freshness: null,
    };
  }

  const profileObj = profile.data as Record<string, unknown>;
  const metricObj = (metric.data as Record<string, unknown>).metric as Record<string, unknown>;
  return {
    data: {
      sector: (profileObj.finnhubIndustry as string) || null,
      marketCap: parseNumber(profileObj.marketCapitalization),
      pe: parseNumber(metricObj?.peBasicExclExtraTTM),
      eps: parseNumber(metricObj?.epsInclExtraItemsTTM),
      roe: parseNumber(metricObj?.roeTTM),
      currentRatio: parseNumber(metricObj?.currentRatioQuarterly),
      debtToEquity: parseNumber(metricObj?.totalDebt2TotalEquityQuarterly),
      operatingMargin: parseNumber(metricObj?.operatingMarginTTM),
    },
    error: null,
    freshness: new Date().toISOString(),
  };
}

export async function fetchEarnings(symbol: string): Promise<{
  data: EarningsInfo;
  error: string | null;
  freshness: string | null;
}> {
  const token = key();
  if (!token) {
    return {
      data: { date: null, tradingDaysAway: null, inBlackoutWindow: false, isUnknown: true },
      error: 'FINNHUB_API_KEY missing',
      freshness: null,
    };
  }
  const url = `${FINNHUB_BASE}/calendar/earnings?symbol=${symbol}&token=${token}`;
  const response = await fetchCachedJson({
    provider: 'finnhub',
    key: `earnings:${symbol}`,
    url,
    ttlMs: PROVIDER_TTL_MS.earnings,
  });
  if (!response.data) {
    return {
      data: { date: null, tradingDaysAway: null, inBlackoutWindow: false, isUnknown: true },
      error: response.error || 'earnings fetch failure',
      freshness: null,
    };
  }
  const payload = response.data as Record<string, unknown>;
  const rows = (payload.earningsCalendar || payload.earnings || []) as Record<string, unknown>[];
  const first = rows[0];
  const date = first ? String(first.date || '') : '';
  if (!date) {
    return {
      data: { date: null, tradingDaysAway: null, inBlackoutWindow: false, isUnknown: true },
      error: 'earnings date missing',
      freshness: new Date().toISOString(),
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const tradingDays = tradingDaysBetween(today, date);
  const inBlackout =
    tradingDays === null ? true : tradingDays >= -2 && tradingDays <= 1;
  return {
    data: {
      date,
      tradingDaysAway: tradingDays,
      inBlackoutWindow: inBlackout,
      isUnknown: false,
    },
    error: null,
    freshness: new Date().toISOString(),
  };
}

function sentimentClass(score: number): 'IMPROVING' | 'FLAT' | 'DETERIORATING' {
  if (score > 0.1) return 'IMPROVING';
  if (score < -0.1) return 'DETERIORATING';
  return 'FLAT';
}

export async function fetchNewsSnapshot(symbol: string): Promise<{
  data: NewsSnapshot;
  error: string | null;
  freshness: string | null;
}> {
  const token = key();
  if (!token) {
    return {
      data: {
        sentimentDirection: 'FLAT',
        intensityRatio: 1,
        divergence: false,
        headlineCount7d: 0,
        headlineCountBaseline: 0,
      },
      error: 'FINNHUB_API_KEY missing',
      freshness: null,
    };
  }
  const today = new Date();
  const from7d = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const from30d = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  const url7 = `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${from7d}&to=${to}&token=${token}`;
  const url30 = `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${from30d}&to=${to}&token=${token}`;
  const [news7, news30] = await Promise.all([
    fetchCachedJson({
      provider: 'finnhub',
      key: `news7:${symbol}:${to}`,
      url: url7,
      ttlMs: PROVIDER_TTL_MS.news,
    }),
    fetchCachedJson({
      provider: 'finnhub',
      key: `news30:${symbol}:${to}`,
      url: url30,
      ttlMs: PROVIDER_TTL_MS.news,
    }),
  ]);
  if (!news7.data || !news30.data) {
    return {
      data: {
        sentimentDirection: 'FLAT',
        intensityRatio: 1,
        divergence: false,
        headlineCount7d: 0,
        headlineCountBaseline: 0,
      },
      error: news7.error || news30.error || 'news fetch failure',
      freshness: null,
    };
  }
  const list7 = news7.data as Record<string, unknown>[];
  const list30 = news30.data as Record<string, unknown>[];
  const count7 = list7.length;
  const baselineWeekly = Math.max(1, Math.round(list30.length / 4));
  const intensity = count7 / baselineWeekly;
  const sentimentValues = list7
    .map((n) => parseNumber(n.sentiment))
    .filter((v): v is number => v !== null);
  const avgSentiment =
    sentimentValues.length === 0
      ? 0
      : sentimentValues.reduce((sum, v) => sum + v, 0) / sentimentValues.length;
  return {
    data: {
      sentimentDirection: sentimentClass(avgSentiment),
      intensityRatio: intensity,
      divergence: intensity > 1.8 && avgSentiment < -0.1,
      headlineCount7d: count7,
      headlineCountBaseline: baselineWeekly,
    },
    error: null,
    freshness: new Date().toISOString(),
  };
}
