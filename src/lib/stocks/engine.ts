
import { computeSectorStats } from '@/lib/convergence/sector-stats';
import { scoreAll } from '@/lib/convergence/composite';
import type {
  CandleData,
  ConvergenceInput,
  FinnhubEarnings,
  FinnhubFundamentals,
  FinnhubInsiderSentiment,
  FinnhubRecommendation,
  FredMacroData,
  StockScannerData,
} from '@/lib/convergence/types';
import type {
  CachedDailyScan,
  DailyIndicators,
  DailyScanResult,
  IntradayIndicators,
  PositionPlan,
  ScannerMetricExtended,
  ScoredUniverseRow,
  ShortlistRefreshResult,
  StockEngineConfig,
  StockTradeCard,
  TradeDirection,
  TriggerDecision,
} from './types';
import { atr, bollinger, clamp, ema, round, rsi, sma } from './indicators';
import { SEED_SYMBOLS } from './symbols';

const DEFAULT_CONFIG: StockEngineConfig = {
  accountSize: 100,
  riskPerTradePct: 10,
  maxCapitalPerPositionPct: 40,
  maxOpenPositions: 5,
  maxPerSector: 2,
  minPrice: 10,
  maxPrice: 100,
  minShortPrice: 10,
  earningsBlackoutDays: 2,
  topUniverseSize: 200,
  scoringShortlistSize: 30,
  intradayShortlistSize: 20,
};

const DAILY_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
const SHORTLIST_CACHE_TTL_MS = 15 * 60 * 1000;
const FRED_CACHE_TTL_MS = 60 * 60 * 1000;
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const DAILY_FETCH_CONCURRENCY = 24;
const INTRADAY_FETCH_CONCURRENCY = 12;
const PROFILE_FETCH_CONCURRENCY = 8;

interface FinnhubTickerEnrichment {
  fundamentals: FinnhubFundamentals | null;
  recommendations: FinnhubRecommendation[];
  insiderSentiment: FinnhubInsiderSentiment[];
  earnings: FinnhubEarnings[];
}

interface FinnhubBatchResult {
  data: Map<string, FinnhubTickerEnrichment>;
  stats: {
    calls_made: number;
    errors: number;
    retries: number;
  };
  errors: string[];
}

interface FinnhubProfile {
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  companyName: string | null;
}

interface YahooCandleResponse {
  symbol: string;
  candles: CandleData[];
  error: string | null;
}

type FetchJsonResult = {
  data: unknown | null;
  status: number;
  error: string | null;
  retries: number;
};

const EMPTY_FINNHUB: FinnhubTickerEnrichment = {
  fundamentals: null,
  recommendations: [],
  insiderSentiment: [],
  earnings: [],
};

const EMPTY_FRED: FredMacroData = {
  vix: null,
  treasury10y: null,
  fedFunds: null,
  unemployment: null,
  cpi: null,
  gdp: null,
  consumerConfidence: null,
  nonfarmPayrolls: null,
  cpiMom: null,
  sofr: null,
};

const dailyCache = new Map<string, CachedDailyScan>();
const shortlistCache = new Map<string, { generatedAtMs: number; result: ShortlistRefreshResult }>();
const profileCache = new Map<string, { fetchedAtMs: number; profile: FinnhubProfile }>();
let fredCache: { fetchedAtMs: number; data: FredMacroData } | null = null;

function cacheKey(userId: string): string {
  return `stocks_manual_${userId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(ms?: number): string {
  return new Date(ms ?? Date.now()).toISOString();
}

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

function toYahooSymbol(symbol: string): string {
  if (symbol === 'BRKB') return 'BRK-B';
  if (symbol === 'BFB') return 'BF-B';
  return symbol.replace(/\./g, '-');
}

function fromYahooSymbol(symbol: string): string {
  if (symbol === 'BRK-B') return 'BRKB';
  if (symbol === 'BF-B') return 'BFB';
  return symbol.toUpperCase();
}

async function fetchJsonWithRetry(url: string): Promise<FetchJsonResult> {
  let retries = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.status === 429 && attempt === 0) {
        retries += 1;
        await sleep(4000);
        continue;
      }
      if (!resp.ok) {
        return {
          data: null,
          status: resp.status,
          error: `HTTP ${resp.status}`,
          retries,
        };
      }
      const data = await resp.json();
      return {
        data,
        status: resp.status,
        error: null,
        retries,
      };
    } catch (error: unknown) {
      if (attempt === 0) {
        retries += 1;
        await sleep(1200);
        continue;
      }
      return {
        data: null,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        retries,
      };
    }
  }

  return {
    data: null,
    status: 0,
    error: 'Unknown fetch failure',
    retries,
  };
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function runWorker(): Promise<void> {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function parseYahooCandles(
  symbol: string,
  raw: unknown,
): { candles: CandleData[]; error: string | null } {
  const json = raw as Record<string, unknown>;
  const chart = (json['chart'] || {}) as Record<string, unknown>;
  const results = (chart['result'] || []) as Record<string, unknown>[];
  const first = results[0];
  if (!first) return { candles: [], error: 'No chart result' };

  const timestamps = (first['timestamp'] || []) as number[];
  const indicators = (first['indicators'] || {}) as Record<string, unknown>;
  const quoteArr = (indicators['quote'] || []) as Record<string, unknown>[];
  const quote = quoteArr[0];

  if (!Array.isArray(timestamps) || timestamps.length === 0 || !quote) {
    return { candles: [], error: 'Missing timestamp/quote arrays' };
  }

  const opens = (quote['open'] || []) as unknown[];
  const highs = (quote['high'] || []) as unknown[];
  const lows = (quote['low'] || []) as unknown[];
  const closes = (quote['close'] || []) as unknown[];
  const volumes = (quote['volume'] || []) as unknown[];

  const candles: CandleData[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = Number(timestamps[i]);
    const open = parseNumber(opens[i]);
    const high = parseNumber(highs[i]);
    const low = parseNumber(lows[i]);
    const close = parseNumber(closes[i]);
    const volume = parseNumber(volumes[i]) ?? 0;
    if (!Number.isFinite(ts) || !open || !high || !low || !close) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;

    const timeMs = ts * 1000;
    candles.push({
      time: timeMs,
      date: new Date(timeMs).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: Math.max(0, volume),
    });
  }

  candles.sort((a, b) => a.time - b.time);
  const dedup = new Map<number, CandleData>();
  for (const candle of candles) dedup.set(candle.time, candle);

  const out = Array.from(dedup.values());
  if (out.length === 0) {
    return { candles: [], error: `No valid OHLCV bars for ${symbol}` };
  }
  return { candles: out, error: null };
}

async function fetchYahooCandles(
  symbol: string,
  range: string,
  interval: string,
): Promise<YahooCandleResponse> {
  const yahooSymbol = toYahooSymbol(symbol);
  const url =
    `${YAHOO_CHART_BASE}/${encodeURIComponent(yahooSymbol)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}` +
    '&includePrePost=false&events=div%2Csplits';

  const resp = await fetchJsonWithRetry(url);
  if (resp.error || !resp.data) {
    return {
      symbol,
      candles: [],
      error: `${symbol}: ${resp.error || 'empty response'}`,
    };
  }

  const parsed = parseYahooCandles(symbol, resp.data);
  return {
    symbol: fromYahooSymbol(symbol),
    candles: parsed.candles,
    error: parsed.error,
  };
}

function computeAnnualizedHv(candles: CandleData[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const tail = candles.slice(-(lookback + 1));
  const logReturns: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1].close;
    const curr = tail[i].close;
    if (prev <= 0 || curr <= 0) continue;
    const r = Math.log(curr / prev);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < Math.max(10, lookback - 4)) return null;

  const mean =
    logReturns.reduce((sum, v) => sum + v, 0) / Math.max(1, logReturns.length);
  const variance =
    logReturns.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
    Math.max(1, logReturns.length - 1);
  const dailyStd = Math.sqrt(Math.max(0, variance));
  return round(dailyStd * Math.sqrt(252) * 100, 2);
}
function latestValue(values: number[]): number | null {
  if (values.length === 0) return null;
  return values[values.length - 1];
}

function latestNonZeroVolume(candles: CandleData[]): number | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    const v = candles[i].volume;
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 20) return null;
  const meanA = a.reduce((sum, v) => sum + v, 0) / a.length;
  const meanB = b.reduce((sum, v) => sum + v, 0) / b.length;

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
  return round(cov / Math.sqrt(varA * varB), 4);
}

function buildReturnMap(candles: CandleData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev <= 0 || curr <= 0) continue;
    map.set(candles[i].date, curr / prev - 1);
  }
  return map;
}

function computeCorrSpy(symbolCandles: CandleData[], spyCandles: CandleData[]): number | null {
  const symRet = buildReturnMap(symbolCandles);
  const spyRet = buildReturnMap(spyCandles);
  const commonDates = Array.from(symRet.keys())
    .filter((d) => spyRet.has(d))
    .sort((a, b) => a.localeCompare(b))
    .slice(-60);

  const a: number[] = [];
  const b: number[] = [];
  for (const date of commonDates) {
    const rvA = symRet.get(date);
    const rvB = spyRet.get(date);
    if (rvA == null || rvB == null) continue;
    a.push(rvA);
    b.push(rvB);
  }
  return correlation(a, b);
}

function liquidityRatingFromDollarVolume(dollarVolume: number | null): number | null {
  if (dollarVolume === null || dollarVolume <= 0) return null;
  if (dollarVolume >= 5_000_000_000) return 5;
  if (dollarVolume >= 2_000_000_000) return 4;
  if (dollarVolume >= 700_000_000) return 3;
  if (dollarVolume >= 200_000_000) return 2;
  return 1;
}

function normalizeSector(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  return text ? text : null;
}

function pickMetricNumber(
  metric: Record<string, number | string | null>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const parsed = parseNumber(metric[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function buildBaseMetricFromCandles(
  symbol: string,
  candles: CandleData[],
  earningsDate: string | null,
  daysTillEarnings: number | null,
  spyCandles: CandleData[],
): ScannerMetricExtended {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastPrice = latestValue(closes);
  const dayVolume = latestNonZeroVolume(candles);
  const avgVolume20 = sma(volumes, 20);
  const dollarVolume =
    lastPrice !== null && avgVolume20 !== null ? round(lastPrice * avgVolume20, 0) : null;
  const hv30 = computeAnnualizedHv(candles, 30);
  const hv60 = computeAnnualizedHv(candles, 60);
  const hv90 = computeAnnualizedHv(candles, 90);
  const corrSpy = spyCandles.length >= 40 ? computeCorrSpy(candles, spyCandles) : null;

  return {
    symbol: symbol.toUpperCase(),
    ivRank: 50,
    ivPercentile: 50,
    impliedVolatility: 0,
    liquidityRating: liquidityRatingFromDollarVolume(dollarVolume),
    earningsDate,
    daysTillEarnings,
    hv30,
    hv60,
    hv90,
    iv30: null,
    ivHvSpread: null,
    beta: null,
    corrSpy,
    marketCap: null,
    sector: null,
    industry: null,
    peRatio: null,
    eps: null,
    dividendYield: null,
    lendability: null,
    borrowRate: null,
    earningsActualEps: null,
    earningsEstimate: null,
    earningsTimeOfDay: null,
    termStructure: [],
    lastPrice,
    dayVolume,
    dollarVolume,
  };
}

async function fetchEarningsBlackoutMap(
  blackoutDays: number,
): Promise<{ map: Map<string, { date: string; days: number }>; error: string | null }> {
  const out = new Map<string, { date: string; days: number }>();
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return { map: out, error: 'FINNHUB_API_KEY missing: earnings blackout unavailable' };
  }

  const today = new Date();
  const future = new Date(today.getTime() + blackoutDays * 86400000);
  const url =
    `${FINNHUB_BASE}/calendar/earnings` +
    `?from=${ymd(today)}&to=${ymd(future)}&token=${key}`;

  const resp = await fetchJsonWithRetry(url);
  if (resp.error || !resp.data) {
    return { map: out, error: `earnings-calendar: ${resp.error || 'no data'}` };
  }

  const payload = resp.data as Record<string, unknown>;
  const rows = (payload['earningsCalendar'] || payload['earnings'] || []) as Record<
    string,
    unknown
  >[];
  const now = new Date();

  for (const row of rows) {
    const symbol = String(row['symbol'] || '').toUpperCase();
    const date = String(row['date'] || '');
    if (!symbol || !date) continue;
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const days = daysBetween(now, d);
    out.set(symbol, { date, days });
  }

  return { map: out, error: null };
}

async function fetchDailyUniverseData(
  symbols: string[],
  earningsMap: Map<string, { date: string; days: number }>,
): Promise<{
  rows: ScannerMetricExtended[];
  dailyCandles: Map<string, CandleData[]>;
  errors: string[];
}> {
  const errors: string[] = [];
  const dailyCandles = new Map<string, CandleData[]>();
  const rows: ScannerMetricExtended[] = [];

  const spy = await fetchYahooCandles('SPY', '1y', '1d');
  if (spy.error) errors.push(`SPY daily candles: ${spy.error}`);
  const spyCandles = spy.candles;

  const fetched = await mapLimit(symbols, DAILY_FETCH_CONCURRENCY, async (symbol) => {
    const result = await fetchYahooCandles(symbol, '1y', '1d');
    return result;
  });

  for (const result of fetched) {
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    const symbol = result.symbol.toUpperCase();
    if (result.candles.length < 80) {
      errors.push(`${symbol}: insufficient daily candles (${result.candles.length})`);
      continue;
    }
    const earnings = earningsMap.get(symbol);
    const metric = buildBaseMetricFromCandles(
      symbol,
      result.candles,
      earnings?.date ?? null,
      earnings?.days ?? null,
      spyCandles,
    );
    rows.push(metric);
    dailyCandles.set(symbol, result.candles);
  }

  return { rows, dailyCandles, errors };
}
async function fetchIntradayCandlesBatch(
  symbols: string[],
): Promise<{ data: Map<string, CandleData[]>; errors: string[] }> {
  const data = new Map<string, CandleData[]>();
  const errors: string[] = [];
  if (symbols.length === 0) return { data, errors };

  const fetched = await mapLimit(symbols, INTRADAY_FETCH_CONCURRENCY, async (symbol) => {
    const result = await fetchYahooCandles(symbol, '30d', '15m');
    return result;
  });

  for (const result of fetched) {
    const symbol = result.symbol.toUpperCase();
    if (result.error || result.candles.length < 40) {
      data.set(symbol, []);
      errors.push(`intraday candles missing: ${symbol}`);
      continue;
    }
    data.set(symbol, result.candles);
  }

  return { data, errors };
}

async function fetchFinnhubBatchLite(
  symbols: string[],
  delayMs = 220,
): Promise<FinnhubBatchResult> {
  const data = new Map<string, FinnhubTickerEnrichment>();
  const stats = { calls_made: 0, errors: 0, retries: 0 };
  const errors: string[] = [];
  const key = process.env.FINNHUB_API_KEY;

  if (!key) {
    for (const symbol of symbols) data.set(symbol, { ...EMPTY_FINNHUB });
    errors.push('FINNHUB_API_KEY missing: fundamentals/info-edge enrichment unavailable');
    return { data, stats, errors };
  }

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const metricUrl = `${FINNHUB_BASE}/stock/metric?symbol=${symbol}&metric=all&token=${key}`;
    const recUrl = `${FINNHUB_BASE}/stock/recommendation?symbol=${symbol}&token=${key}`;
    const insiderUrl =
      `${FINNHUB_BASE}/stock/insider-sentiment?symbol=${symbol}&from=2024-01-01&token=${key}`;
    const earningsUrl = `${FINNHUB_BASE}/stock/earnings?symbol=${symbol}&token=${key}`;

    const [metricResp, recResp, insiderResp, earningsResp] = await Promise.all([
      fetchJsonWithRetry(metricUrl),
      fetchJsonWithRetry(recUrl),
      fetchJsonWithRetry(insiderUrl),
      fetchJsonWithRetry(earningsUrl),
    ]);

    stats.calls_made += 4;
    stats.retries +=
      metricResp.retries + recResp.retries + insiderResp.retries + earningsResp.retries;

    let fundamentals: FinnhubFundamentals | null = null;
    let recommendations: FinnhubRecommendation[] = [];
    let insiderSentiment: FinnhubInsiderSentiment[] = [];
    let earnings: FinnhubEarnings[] = [];

    if (metricResp.error || !metricResp.data) {
      stats.errors += 1;
      errors.push(`${symbol} fundamentals: ${metricResp.error || 'no data'}`);
    } else {
      const metricPayload = metricResp.data as Record<string, unknown>;
      const metric = (metricPayload['metric'] || {}) as Record<string, number | string | null>;
      fundamentals = { metric, fieldCount: Object.keys(metric).length };
    }

    if (recResp.error || !recResp.data) {
      stats.errors += 1;
      errors.push(`${symbol} recommendations: ${recResp.error || 'no data'}`);
    } else {
      const recs = recResp.data as FinnhubRecommendation[];
      recommendations = Array.isArray(recs) ? recs : [];
    }

    if (insiderResp.error || !insiderResp.data) {
      stats.errors += 1;
      errors.push(`${symbol} insider sentiment: ${insiderResp.error || 'no data'}`);
    } else {
      const insiderPayload = insiderResp.data as Record<string, unknown>;
      const rows = (insiderPayload['data'] || []) as FinnhubInsiderSentiment[];
      insiderSentiment = Array.isArray(rows) ? rows : [];
    }

    if (earningsResp.error || !earningsResp.data) {
      stats.errors += 1;
      errors.push(`${symbol} earnings history: ${earningsResp.error || 'no data'}`);
    } else {
      const rows = earningsResp.data as FinnhubEarnings[];
      earnings = Array.isArray(rows) ? rows : [];
    }

    data.set(symbol, { fundamentals, recommendations, insiderSentiment, earnings });

    if (i < symbols.length - 1) {
      await sleep(delayMs);
    }
  }

  return { data, stats, errors };
}

async function fetchFinnhubProfilesBatch(
  symbols: string[],
): Promise<{ profiles: Map<string, FinnhubProfile>; errors: string[] }> {
  const profiles = new Map<string, FinnhubProfile>();
  const errors: string[] = [];
  const key = process.env.FINNHUB_API_KEY;

  if (!key) {
    return { profiles, errors: ['FINNHUB_API_KEY missing: sector profile enrichment unavailable'] };
  }

  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const now = Date.now();

  const fetched = await mapLimit(unique, PROFILE_FETCH_CONCURRENCY, async (symbol) => {
    const cached = profileCache.get(symbol);
    if (cached && now - cached.fetchedAtMs < PROFILE_CACHE_TTL_MS) {
      return { symbol, profile: cached.profile, error: null as string | null };
    }

    const url = `${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${key}`;
    const resp = await fetchJsonWithRetry(url);
    if (resp.error || !resp.data) {
      return { symbol, profile: null as FinnhubProfile | null, error: resp.error || 'no data' };
    }

    const payload = resp.data as Record<string, unknown>;
    const industry = normalizeSector(payload['finnhubIndustry']);
    const marketCapRaw = parseNumber(payload['marketCapitalization']);
    const profile: FinnhubProfile = {
      sector: industry,
      industry,
      marketCap: marketCapRaw !== null ? marketCapRaw * 1_000_000 : null,
      companyName: typeof payload['name'] === 'string' ? payload['name'] : null,
    };
    profileCache.set(symbol, { fetchedAtMs: now, profile });
    return { symbol, profile, error: null as string | null };
  });

  for (const row of fetched) {
    if (row.error || !row.profile) {
      errors.push(`${row.symbol} profile: ${row.error || 'no data'}`);
      continue;
    }
    profiles.set(row.symbol, row.profile);
  }

  return { profiles, errors };
}

async function fetchFredLatestObservation(
  seriesId: string,
  apiKey: string,
  limit = 1,
): Promise<number[] | null> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;

  const resp = await fetchJsonWithRetry(url);
  if (resp.error || !resp.data) return null;

  const payload = resp.data as Record<string, unknown>;
  const obs = (payload['observations'] || []) as Record<string, unknown>[];
  const out: number[] = [];
  for (const row of obs) {
    const rawValue = row['value'];
    if (rawValue === '.' || rawValue === undefined || rawValue === null) continue;
    const parsed = parseNumber(rawValue);
    if (parsed !== null) out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

async function fetchFredMacroLite(): Promise<{ data: FredMacroData; cached: boolean; error: string | null }> {
  if (fredCache && Date.now() - fredCache.fetchedAtMs < FRED_CACHE_TTL_MS) {
    return { data: fredCache.data, cached: true, error: null };
  }

  const key = process.env.FRED_API_KEY;
  if (!key) {
    return { data: EMPTY_FRED, cached: false, error: 'FRED_API_KEY missing: regime macro uses neutral defaults' };
  }

  const errors: string[] = [];
  const data: FredMacroData = { ...EMPTY_FRED };

  const simpleSeries: Array<{ key: keyof FredMacroData; id: string }> = [
    { key: 'vix', id: 'VIXCLS' },
    { key: 'treasury10y', id: 'DGS10' },
    { key: 'fedFunds', id: 'FEDFUNDS' },
    { key: 'unemployment', id: 'UNRATE' },
    { key: 'gdp', id: 'A191RL1Q225SBEA' },
    { key: 'consumerConfidence', id: 'UMCSENT' },
    { key: 'sofr', id: 'SOFR' },
  ];

  for (const series of simpleSeries) {
    const values = await fetchFredLatestObservation(series.id, key, 1);
    if (!values || values.length === 0) {
      errors.push(`${series.id}: missing`);
    } else {
      data[series.key] = values[0];
    }
    await sleep(80);
  }

  const nfp = await fetchFredLatestObservation('PAYEMS', key, 2);
  if (nfp && nfp.length >= 2) {
    data.nonfarmPayrolls = round(nfp[0] - nfp[1], 2);
  } else {
    errors.push('PAYEMS: missing');
  }
  await sleep(80);

  const cpi = await fetchFredLatestObservation('CPIAUCSL', key, 13);
  if (cpi && cpi.length >= 2) {
    const current = cpi[0];
    const prevMonth = cpi[1];
    if (prevMonth !== 0) {
      data.cpiMom = round(((current - prevMonth) / prevMonth) * 100, 2);
    }
    if (cpi.length >= 13) {
      const yearAgo = cpi[12];
      if (yearAgo !== 0) {
        data.cpi = round(((current - yearAgo) / yearAgo) * 100, 2);
      }
    }
  } else {
    errors.push('CPIAUCSL: missing');
  }

  fredCache = { fetchedAtMs: Date.now(), data };
  return { data, cached: false, error: errors.length > 0 ? errors.join('; ') : null };
}
function computeDailyIndicators(candles: CandleData[]): DailyIndicators {
  const closes = candles.map((c) => c.close);
  return {
    close: closes.length > 0 ? closes[closes.length - 1] : null,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
  };
}

function computeIntradayIndicators(candles: CandleData[]): IntradayIndicators {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const bands = bollinger(closes, 20, 2);
  return {
    close: closes.length > 0 ? closes[closes.length - 1] : null,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    upperBand: bands.upper,
    lowerBand: bands.lower,
    avgVolume20: sma(volumes, 20),
    lastVolume: volumes.length > 0 ? volumes[volumes.length - 1] : null,
  };
}

function computeDailyBiasScore(
  metric: ScannerMetricExtended,
  indicators: DailyIndicators,
): { score: number; direction: TradeDirection; setupHint: 'Breakout' | 'Pullback' | 'Mean Reversion' | 'None' } {
  let score = 50;
  const { close, sma20, sma50, rsi14 } = indicators;

  const trendBull =
    close !== null && sma20 !== null && sma50 !== null && close > sma20 && sma20 > sma50;
  const trendBear =
    close !== null && sma20 !== null && sma50 !== null && close < sma20 && sma20 < sma50;
  if (trendBull) score += 20;
  if (trendBear) score -= 20;

  if (rsi14 !== null) {
    if (rsi14 >= 55 && rsi14 <= 70) score += 10;
    else if (rsi14 <= 45 && rsi14 >= 30) score -= 10;
    else if (rsi14 < 30) score += 4;
    else if (rsi14 > 70) score -= 4;
  }

  if (metric.hv30 !== null && metric.hv60 !== null && metric.hv90 !== null) {
    if (metric.hv30 < metric.hv60 && metric.hv60 < metric.hv90) score += 5;
    if (metric.hv30 > metric.hv60 && metric.hv60 > metric.hv90) score -= 5;
  }

  if (metric.corrSpy !== null) {
    if (Math.abs(metric.corrSpy) > 0.75) score += 2;
  }

  if (metric.liquidityRating !== null) {
    score += clamp((metric.liquidityRating - 3) * 3, -6, 6);
  }

  score = round(clamp(score, 0, 100), 1);
  const direction: TradeDirection = score >= 60 ? 'LONG' : score <= 40 ? 'SHORT' : 'WATCH';

  let setupHint: 'Breakout' | 'Pullback' | 'Mean Reversion' | 'None' = 'None';
  if (direction === 'LONG') {
    setupHint = trendBull ? 'Pullback' : 'Breakout';
  } else if (direction === 'SHORT') {
    setupHint = trendBear ? 'Pullback' : 'Breakout';
  } else if (rsi14 !== null && (rsi14 < 35 || rsi14 > 65)) {
    setupHint = 'Mean Reversion';
  }

  return { score, direction, setupHint };
}

function buildUniverseRows(
  rows: ScannerMetricExtended[],
  dailyCandles: Map<string, CandleData[]>,
): ScoredUniverseRow[] {
  return rows.map((row) => {
    const candles = dailyCandles.get(row.symbol) || [];
    const daily = computeDailyIndicators(candles);
    const bias = computeDailyBiasScore(row, daily);
    return {
      symbol: row.symbol,
      sector: row.sector,
      lastPrice: row.lastPrice,
      dayVolume: row.dayVolume,
      dollarVolume: row.dollarVolume,
      dailyBiasScore: bias.score,
      dailyBiasDirection: bias.direction,
      setupTypeHint: bias.setupHint,
      ivRank: row.ivRank,
      ivHvSpread: row.ivHvSpread,
      liquidity: row.liquidityRating,
      marketCap: row.marketCap,
      earningsInDays: row.daysTillEarnings,
    };
  });
}

function maxHigh(candles: CandleData[], n: number): number | null {
  if (candles.length < n) return null;
  return Math.max(...candles.slice(-n).map((c) => c.high));
}

function minLow(candles: CandleData[], n: number): number | null {
  if (candles.length < n) return null;
  return Math.min(...candles.slice(-n).map((c) => c.low));
}

function deriveIntradayTrigger(
  dailyDirection: TradeDirection,
  candles: CandleData[],
): TriggerDecision {
  if (candles.length < 30) {
    return { setupType: 'None', direction: 'WATCH', triggerScore: 0, notes: ['Insufficient 15m candles'] };
  }

  const i = computeIntradayIndicators(candles);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev20High = maxHigh(candles.slice(0, -1), 20);
  const prev20Low = minLow(candles.slice(0, -1), 20);

  let longScore = 0;
  let shortScore = 0;
  let longSetup: TriggerDecision['setupType'] = 'None';
  let shortSetup: TriggerDecision['setupType'] = 'None';
  const notes: string[] = [];

  if (prev20High !== null && i.avgVolume20 !== null && i.lastVolume !== null && last.close > prev20High && i.lastVolume > i.avgVolume20 * 1.2) {
    longScore = Math.max(longScore, 78);
    longSetup = 'Breakout';
    notes.push(`15m breakout: close ${round(last.close, 2)} > prior 20-bar high ${round(prev20High, 2)} with volume ${round(i.lastVolume, 0)} > avg ${round(i.avgVolume20, 0)}.`);
  }
  if (prev20Low !== null && i.avgVolume20 !== null && i.lastVolume !== null && last.close < prev20Low && i.lastVolume > i.avgVolume20 * 1.2) {
    shortScore = Math.max(shortScore, 78);
    shortSetup = 'Breakout';
    notes.push(`15m downside breakout: close ${round(last.close, 2)} < prior 20-bar low ${round(prev20Low, 2)} with volume confirmation.`);
  }

  if (i.ema9 !== null && i.ema21 !== null && i.ema9 > i.ema21 && last.low <= i.ema9 * 1.003 && last.close > i.ema9 && last.close > prev.high) {
    longScore = Math.max(longScore, 70);
    if (longSetup === 'None') longSetup = 'Pullback';
    notes.push(`15m pullback long: EMA9 ${round(i.ema9, 2)} > EMA21 ${round(i.ema21, 2)} and price reclaimed EMA9.`);
  }
  if (i.ema9 !== null && i.ema21 !== null && i.ema9 < i.ema21 && last.high >= i.ema9 * 0.997 && last.close < i.ema9 && last.close < prev.low) {
    shortScore = Math.max(shortScore, 70);
    if (shortSetup === 'None') shortSetup = 'Pullback';
    notes.push(`15m pullback short: EMA9 ${round(i.ema9, 2)} < EMA21 ${round(i.ema21, 2)} and price rejected EMA9.`);
  }

  if (i.rsi14 !== null && i.lowerBand !== null && i.rsi14 < 35 && last.close <= i.lowerBand * 1.01 && last.close > prev.close) {
    longScore = Math.max(longScore, 62);
    if (longSetup === 'None') longSetup = 'Mean Reversion';
    notes.push(`15m mean-reversion long: RSI ${round(i.rsi14, 1)} and close near lower band ${round(i.lowerBand, 2)}.`);
  }
  if (i.rsi14 !== null && i.upperBand !== null && i.rsi14 > 65 && last.close >= i.upperBand * 0.99 && last.close < prev.close) {
    shortScore = Math.max(shortScore, 62);
    if (shortSetup === 'None') shortSetup = 'Mean Reversion';
    notes.push(`15m mean-reversion short: RSI ${round(i.rsi14, 1)} and close near upper band ${round(i.upperBand, 2)}.`);
  }

  if (dailyDirection === 'LONG' && longScore >= 60) {
    return {
      setupType: longSetup,
      direction: 'LONG',
      triggerScore: longScore,
      notes,
    };
  }
  if (dailyDirection === 'SHORT' && shortScore >= 60) {
    return {
      setupType: shortSetup,
      direction: 'SHORT',
      triggerScore: shortScore,
      notes,
    };
  }

  return {
    setupType: 'None',
    direction: 'WATCH',
    triggerScore: Math.max(longScore, shortScore),
    notes: notes.length ? notes : ['No aligned 15m trigger for current daily bias'],
  };
}

function buildPositionPlan(
  direction: TradeDirection,
  entry: number | null,
  intraday: IntradayIndicators,
  score: number,
  config: StockEngineConfig,
): PositionPlan {
  const maxRiskDollars = round(config.accountSize * (config.riskPerTradePct / 100), 2);
  const maxCapitalDollars = round(config.accountSize * (config.maxCapitalPerPositionPct / 100), 2);

  if (direction === 'WATCH' || entry === null || entry <= 0) {
    return {
      entry: entry ?? null,
      stop: null,
      target1: null,
      target2: null,
      riskPerShare: null,
      riskRewardToT1: null,
      riskRewardToT2: null,
      stopPct: null,
      maxRiskDollars,
      maxCapitalDollars,
      shares: 0,
      notional: 0,
      holdDays: 0,
    };
  }

  const atr15 = intraday.atr14 ?? Math.max(entry * 0.015, 0.2);
  const baseRisk = Math.max(atr15 * 1.2, entry * 0.02);
  const riskPerShare = round(baseRisk, 2);

  const stop = direction === 'LONG'
    ? round(entry - riskPerShare, 2)
    : round(entry + riskPerShare, 2);
  const target1 = direction === 'LONG'
    ? round(entry + riskPerShare * 1.6, 2)
    : round(entry - riskPerShare * 1.6, 2);
  const target2 = direction === 'LONG'
    ? round(entry + riskPerShare * 2.6, 2)
    : round(entry - riskPerShare * 2.6, 2);

  const sharesByRisk = Math.floor(maxRiskDollars / Math.max(0.01, riskPerShare));
  const sharesByCapital = Math.floor(maxCapitalDollars / entry);
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByCapital));
  const notional = round(shares * entry, 2);

  const rr1 = riskPerShare > 0 ? round(Math.abs(target1 - entry) / riskPerShare, 2) : null;
  const rr2 = riskPerShare > 0 ? round(Math.abs(target2 - entry) / riskPerShare, 2) : null;

  let holdDays = 8;
  const atrPct = atr15 / entry;
  if (atrPct > 0.05) holdDays = 5;
  else if (atrPct < 0.02) holdDays = 12;
  if (score >= 75) holdDays += 1;
  holdDays = clamp(holdDays, 3, 20);

  return {
    entry,
    stop,
    target1,
    target2,
    riskPerShare,
    riskRewardToT1: rr1,
    riskRewardToT2: rr2,
    stopPct: round((riskPerShare / entry) * 100, 2),
    maxRiskDollars,
    maxCapitalDollars,
    shares,
    notional,
    holdDays,
  };
}
function buildCard(
  symbol: string,
  row: ScannerMetricExtended,
  universeRow: ScoredUniverseRow,
  intradayCandles: CandleData[],
  scoring: ReturnType<typeof scoreAll>,
  trigger: TriggerDecision,
  config: StockEngineConfig,
): StockTradeCard {
  const intraday = computeIntradayIndicators(intradayCandles);
  const entry = intraday.close ?? row.lastPrice ?? null;

  let direction: TradeDirection = 'WATCH';
  if (trigger.direction === 'LONG' && universeRow.dailyBiasDirection === 'LONG' && scoring.composite.categories_above_50 >= 3) {
    direction = 'LONG';
  } else if (
    trigger.direction === 'SHORT' &&
    universeRow.dailyBiasDirection === 'SHORT' &&
    scoring.composite.categories_above_50 >= 3 &&
    (entry ?? 0) >= config.minShortPrice
  ) {
    direction = 'SHORT';
  }

  const plan = buildPositionPlan(direction, entry, intraday, scoring.composite.score, config);

  const explanations: string[] = [];
  explanations.push(
    `${symbol} daily bias is ${universeRow.dailyBiasDirection} (score ${round(universeRow.dailyBiasScore, 1)}). ` +
    `Convergence composite is ${round(scoring.composite.score, 1)} with ${scoring.composite.categories_above_50}/4 categories above 50.`,
  );
  explanations.push(
    `Category scores: Vol-Edge ${round(scoring.composite.category_scores.vol_edge, 1)}, ` +
    `Quality ${round(scoring.composite.category_scores.quality, 1)}, ` +
    `Regime ${round(scoring.composite.category_scores.regime, 1)}, ` +
    `Info-Edge ${round(scoring.composite.category_scores.info_edge, 1)}.`,
  );
  explanations.push(
    `15m trigger is ${trigger.direction} (${trigger.setupType}) with trigger score ${round(trigger.triggerScore, 1)}.`,
  );
  if (row.iv30 === null) {
    explanations.push('Options-chain IV fields are unavailable in stock-only mode, so Vol-Edge uses realized volatility and technical structure.');
  }
  if (trigger.notes.length > 0) explanations.push(trigger.notes[0]);
  if (plan.entry !== null && plan.stop !== null && plan.target1 !== null) {
    explanations.push(
      `Plan: entry ${plan.entry}, stop ${plan.stop}, target1 ${plan.target1}, target2 ${plan.target2}, ` +
      `risk/share ${plan.riskPerShare}, shares ${plan.shares} (whole-share sizing).`,
    );
  }

  const riskFlags: string[] = [];
  if (row.daysTillEarnings !== null && row.daysTillEarnings <= config.earningsBlackoutDays) {
    riskFlags.push(`Earnings in ${row.daysTillEarnings} days.`);
  }
  if (scoring.composite.categories_above_50 < 3) {
    riskFlags.push(`Convergence gate weak: ${scoring.composite.categories_above_50}/4 above 50.`);
  }
  if (direction === 'SHORT' && (entry ?? 0) < config.minShortPrice) {
    riskFlags.push(`Short blocked under $${config.minShortPrice}.`);
  }
  if (plan.shares < 1 && direction !== 'WATCH') {
    riskFlags.push('Position size rounds down to 0 shares under current risk/capital caps.');
  }
  if (!row.sector) {
    riskFlags.push('Sector unavailable; sector-cap enforcement falls back to symbol-level handling.');
  }
  const vix = scoring.regime.breakdown.vix_overlay.vix;
  if (vix !== null && vix > 30) {
    riskFlags.push(`VIX elevated at ${round(vix, 1)}.`);
  }

  return {
    symbol,
    sector: row.sector,
    direction,
    setupType: trigger.setupType,
    score: round(scoring.composite.score, 1),
    dailyBiasScore: round(universeRow.dailyBiasScore, 1),
    triggerScore: round(trigger.triggerScore, 1),
    convergence: scoring.composite.convergence_gate,
    generatedAt: nowIso(),
    plan,
    keyStats: {
      price: entry,
      ivRank: row.iv30 !== null ? row.ivRank : null,
      ivHvSpread: row.ivHvSpread,
      hv30: row.hv30,
      liquidity: row.liquidityRating,
      marketCap: row.marketCap,
      earningsInDays: row.daysTillEarnings,
      vix,
    },
    categoryScores: {
      volEdge: round(scoring.composite.category_scores.vol_edge, 1),
      quality: round(scoring.composite.category_scores.quality, 1),
      regime: round(scoring.composite.category_scores.regime, 1),
      infoEdge: round(scoring.composite.category_scores.info_edge, 1),
    },
    explanations: explanations.slice(0, 6),
    riskFlags,
  };
}

async function getOpenSymbols(_userId: string): Promise<string[]> {
  return [];
}

function selectCardsWithLimits(
  cards: StockTradeCard[],
  openSymbols: string[],
  maxOpen: number,
  maxPerSector: number,
): { selected: StockTradeCard[]; watchlist: StockTradeCard[]; availableSlots: number } {
  const openSet = new Set(openSymbols.map((s) => s.toUpperCase()));
  const availableSlots = Math.max(0, maxOpen - openSet.size);
  const selected: StockTradeCard[] = [];
  const watchlist: StockTradeCard[] = [];

  const sectorCounts = new Map<string, number>();
  for (const card of cards) {
    if (card.direction === 'WATCH' || card.plan.shares < 1) {
      watchlist.push(card);
      continue;
    }

    const symbol = card.symbol.toUpperCase();
    if (openSet.has(symbol)) {
      watchlist.push({
        ...card,
        direction: 'WATCH',
        riskFlags: [...card.riskFlags, 'Already open position'],
      });
      continue;
    }

    if (selected.length >= availableSlots) {
      watchlist.push(card);
      continue;
    }

    const sectorKey = card.sector || `Unknown:${card.symbol}`;
    const count = sectorCounts.get(sectorKey) || 0;
    if (count >= maxPerSector) {
      watchlist.push({
        ...card,
        direction: 'WATCH',
        riskFlags: [...card.riskFlags, `Sector cap hit (${maxPerSector})`],
      });
      continue;
    }

    sectorCounts.set(sectorKey, count + 1);
    selected.push(card);
  }

  return { selected, watchlist, availableSlots };
}

function toStockScannerData(row: ScannerMetricExtended): StockScannerData {
  return {
    symbol: row.symbol,
    ivRank: row.ivRank,
    ivPercentile: row.ivPercentile,
    impliedVolatility: row.impliedVolatility,
    liquidityRating: row.liquidityRating,
    earningsDate: row.earningsDate,
    daysTillEarnings: row.daysTillEarnings,
    hv30: row.hv30,
    hv60: row.hv60,
    hv90: row.hv90,
    iv30: row.iv30,
    ivHvSpread: row.ivHvSpread,
    beta: row.beta,
    corrSpy: row.corrSpy,
    marketCap: row.marketCap,
    sector: row.sector,
    industry: row.industry,
    peRatio: row.peRatio,
    eps: row.eps,
    dividendYield: row.dividendYield,
    lendability: row.lendability,
    borrowRate: row.borrowRate,
    earningsActualEps: row.earningsActualEps,
    earningsEstimate: row.earningsEstimate,
    earningsTimeOfDay: row.earningsTimeOfDay,
    termStructure: row.termStructure,
  };
}

function sortUniverseByLiquidity(rows: ScannerMetricExtended[]): ScannerMetricExtended[] {
  return [...rows].sort((a, b) => {
    const aDollar = a.dollarVolume ?? -1;
    const bDollar = b.dollarVolume ?? -1;
    if (bDollar !== aDollar) return bDollar - aDollar;

    const aLiq = a.liquidityRating ?? -1;
    const bLiq = b.liquidityRating ?? -1;
    if (bLiq !== aLiq) return bLiq - aLiq;

    const aVol = a.dayVolume ?? -1;
    const bVol = b.dayVolume ?? -1;
    return bVol - aVol;
  });
}

function updateMetricFromFinnhub(
  row: ScannerMetricExtended,
  profile: FinnhubProfile | undefined,
  enrichment: FinnhubTickerEnrichment | undefined,
): ScannerMetricExtended {
  const out = { ...row };
  if (profile) {
    out.sector = profile.sector;
    out.industry = profile.industry;
    if (profile.marketCap !== null) out.marketCap = profile.marketCap;
  }

  const metric = enrichment?.fundamentals?.metric || null;
  if (!metric) return out;

  const beta = pickMetricNumber(metric, ['beta']);
  if (beta !== null) out.beta = beta;

  const pe = pickMetricNumber(metric, ['peBasicExclExtraTTM', 'peNormalizedAnnual']);
  if (pe !== null) out.peRatio = pe;

  const eps = pickMetricNumber(metric, ['epsInclExtraItemsTTM', 'epsNormalizedAnnual']);
  if (eps !== null) out.eps = eps;

  const dividendYield = pickMetricNumber(metric, [
    'dividendYieldIndicatedAnnual',
    'dividendYield5Y',
  ]);
  if (dividendYield !== null) out.dividendYield = dividendYield;

  const marketCap = pickMetricNumber(metric, ['marketCapitalization']);
  if (marketCap !== null) out.marketCap = marketCap * 1_000_000;

  return out;
}
async function runFullDailyScan(
  _request: Request,
  userId: string,
  config: StockEngineConfig,
): Promise<DailyScanResult & { scorerInputs: CachedDailyScan['scorerInputs'] }> {
  const start = Date.now();
  const errors: string[] = [];
  const fetchGaps: string[] = [];

  const symbols = [...SEED_SYMBOLS];

  const earnings = await fetchEarningsBlackoutMap(config.earningsBlackoutDays);
  if (earnings.error) fetchGaps.push(earnings.error);

  const dailyFetch = await fetchDailyUniverseData(symbols, earnings.map);
  errors.push(...dailyFetch.errors.slice(0, 50));
  if (dailyFetch.errors.length > 50) {
    fetchGaps.push(`daily fetch additional errors: ${dailyFetch.errors.length - 50}`);
  }

  const preFiltered = dailyFetch.rows.filter((row) => {
    if (row.lastPrice === null || row.dayVolume === null || row.dayVolume <= 0) return false;
    if (row.daysTillEarnings !== null && row.daysTillEarnings >= 0 && row.daysTillEarnings <= config.earningsBlackoutDays) {
      return false;
    }
    return true;
  });

  const priced = preFiltered.filter((row) => {
    if (row.lastPrice === null) return false;
    return row.lastPrice >= config.minPrice && row.lastPrice <= config.maxPrice;
  });

  const rankedUniverse = sortUniverseByLiquidity(priced).slice(0, config.topUniverseSize);
  const rankedMap = new Map(rankedUniverse.map((row) => [row.symbol, row]));
  const dailyCandles = new Map<string, CandleData[]>();
  for (const row of rankedUniverse) {
    const candles = dailyFetch.dailyCandles.get(row.symbol) || [];
    dailyCandles.set(row.symbol, candles);
  }

  let universeRows = buildUniverseRows(rankedUniverse, dailyCandles).sort((a, b) => {
    const aScore = Math.abs(a.dailyBiasScore - 50);
    const bScore = Math.abs(b.dailyBiasScore - 50);
    if (bScore !== aScore) return bScore - aScore;
    return (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0);
  });

  const scoringUniverse = universeRows.slice(0, config.scoringShortlistSize);
  const scoringSymbols = scoringUniverse.map((u) => u.symbol);

  const [finnhub, profiles, fred] = await Promise.all([
    fetchFinnhubBatchLite(scoringSymbols, 220),
    fetchFinnhubProfilesBatch(scoringSymbols),
    fetchFredMacroLite(),
  ]);

  if (finnhub.errors.length > 0) {
    fetchGaps.push(...finnhub.errors.slice(0, 8));
    if (finnhub.errors.length > 8) {
      fetchGaps.push(`finnhub additional errors: ${finnhub.errors.length - 8}`);
    }
  }
  if (profiles.errors.length > 0) {
    fetchGaps.push(...profiles.errors.slice(0, 6));
    if (profiles.errors.length > 6) {
      fetchGaps.push(`profile additional errors: ${profiles.errors.length - 6}`);
    }
  }
  if (fred.error) fetchGaps.push(`fred: ${fred.error}`);

  for (const symbol of scoringSymbols) {
    const current = rankedMap.get(symbol);
    if (!current) continue;
    const merged = updateMetricFromFinnhub(current, profiles.profiles.get(symbol), finnhub.data.get(symbol));
    rankedMap.set(symbol, merged);
  }

  const rankedForScoring = rankedUniverse.map((row) => rankedMap.get(row.symbol) || row);
  universeRows = universeRows.map((u) => {
    const merged = rankedMap.get(u.symbol);
    if (!merged) return u;
    return {
      ...u,
      sector: merged.sector ?? u.sector,
      marketCap: merged.marketCap ?? u.marketCap,
      earningsInDays: merged.daysTillEarnings ?? u.earningsInDays,
    };
  });

  const sectorStats = computeSectorStats(rankedForScoring.map(toStockScannerData));

  const scorerInputs: CachedDailyScan['scorerInputs'] = [];
  for (const symbol of scoringSymbols) {
    const scanner = rankedMap.get(symbol);
    if (!scanner) continue;
    const fh = finnhub.data.get(symbol) || EMPTY_FINNHUB;
    const daily = dailyCandles.get(symbol) || [];

    const input: ConvergenceInput = {
      symbol,
      scanner: toStockScannerData(scanner),
      candles: daily,
      finnhubFundamentals: fh.fundamentals,
      finnhubRecommendations: fh.recommendations,
      finnhubInsiderSentiment: fh.insiderSentiment,
      finnhubEarnings: fh.earnings,
      fredMacro: fred.data,
      annualFinancials: null,
      sectorStats,
    };
    const scoring = scoreAll(input);
    scorerInputs.push({ symbol, scanner, dailyCandles: daily, scoring });
  }

  scorerInputs.sort((a, b) => b.scoring.composite.score - a.scoring.composite.score);

  const intradayTargets = scorerInputs.slice(0, config.intradayShortlistSize);
  const intradaySymbols = intradayTargets.map((s) => s.symbol);
  const intradayResp = await fetchIntradayCandlesBatch(intradaySymbols);
  const missingIntraday = intradayResp.errors.filter((e) => e.startsWith('intraday candles missing:'));
  if (missingIntraday.length > 0) {
    fetchGaps.push(`${missingIntraday.length} symbols missing 15m candles`);
  }

  const universeMap = new Map(universeRows.map((u) => [u.symbol, u]));
  const cards = intradayTargets
    .map((item) => {
      const universeRow = universeMap.get(item.symbol);
      if (!universeRow) return null;
      const intradayCandles = intradayResp.data.get(item.symbol) || [];
      const trigger = deriveIntradayTrigger(universeRow.dailyBiasDirection, intradayCandles);
      return buildCard(
        item.symbol,
        item.scanner,
        universeRow,
        intradayCandles,
        item.scoring,
        trigger,
        config,
      );
    })
    .filter((card): card is StockTradeCard => card !== null)
    .sort((a, b) => (b.score * 0.6 + b.triggerScore * 0.4) - (a.score * 0.6 + a.triggerScore * 0.4));

  const openSymbols = await getOpenSymbols(userId);
  const selected = selectCardsWithLimits(cards, openSymbols, config.maxOpenPositions, config.maxPerSector);

  const summary: DailyScanResult['summary'] = {
    scannerSymbols: symbols.length,
    preFiltered: preFiltered.length,
    priceFiltered: priced.length,
    finalUniverse: rankedUniverse.length,
    scoredWithConvergence: scorerInputs.length,
    intradayEvaluated: intradaySymbols.length,
    openPositions: openSymbols.length,
    availableSlots: selected.availableSlots,
    selectedCards: selected.selected.length,
  };

  const result: DailyScanResult = {
    generatedAt: nowIso(),
    config,
    summary,
    cards: selected.selected,
    watchlist: selected.watchlist.slice(0, 20),
    universe: universeRows,
    diagnostics: {
      errors,
      fetchGaps,
      runtimeMs: Date.now() - start,
    },
  };

  return { ...result, scorerInputs };
}

async function runShortlistRefresh(
  userId: string,
  base: CachedDailyScan,
  config: StockEngineConfig,
): Promise<ShortlistRefreshResult> {
  const start = Date.now();
  const errors: string[] = [];
  const fetchGaps: string[] = [];

  const topInputs = [...base.scorerInputs]
    .sort((a, b) => b.scoring.composite.score - a.scoring.composite.score)
    .slice(0, config.intradayShortlistSize);

  const symbols = topInputs.map((i) => i.symbol);
  const intradayResp = await fetchIntradayCandlesBatch(symbols);
  const missingIntraday = intradayResp.errors.filter((e) => e.startsWith('intraday candles missing:'));
  if (missingIntraday.length > 0) {
    fetchGaps.push(`${missingIntraday.length} symbols missing 15m candles`);
  }

  const universeMap = new Map(base.result.universe.map((u) => [u.symbol, u]));
  const cards = topInputs
    .map((item) => {
      const universeRow = universeMap.get(item.symbol);
      if (!universeRow) return null;
      const intradayCandles = intradayResp.data.get(item.symbol) || [];
      const trigger = deriveIntradayTrigger(universeRow.dailyBiasDirection, intradayCandles);
      return buildCard(
        item.symbol,
        item.scanner,
        universeRow,
        intradayCandles,
        item.scoring,
        trigger,
        config,
      );
    })
    .filter((card): card is StockTradeCard => card !== null)
    .sort((a, b) => (b.score * 0.6 + b.triggerScore * 0.4) - (a.score * 0.6 + a.triggerScore * 0.4));

  const openSymbols = await getOpenSymbols(userId);
  const selected = selectCardsWithLimits(cards, openSymbols, config.maxOpenPositions, config.maxPerSector);

  return {
    generatedAt: nowIso(),
    summary: {
      sourceDailyScanAt: base.result.generatedAt,
      refreshedSymbols: symbols.length,
      selectedCards: selected.selected.length,
      openPositions: openSymbols.length,
      availableSlots: selected.availableSlots,
      runtimeMs: Date.now() - start,
    },
    cards: selected.selected,
    watchlist: selected.watchlist.slice(0, 20),
    diagnostics: {
      errors,
      fetchGaps,
    },
  };
}
export function getDefaultStockConfig(): StockEngineConfig {
  return { ...DEFAULT_CONFIG };
}

export async function getDailyStockScan(
  request: Request,
  userId: string,
  refresh = false,
  configOverride?: Partial<StockEngineConfig>,
): Promise<DailyScanResult> {
  const config = { ...DEFAULT_CONFIG, ...(configOverride || {}) };
  const key = cacheKey(userId);
  const cached = dailyCache.get(key);
  if (!refresh && cached && Date.now() - cached.generatedAtMs < DAILY_CACHE_TTL_MS) {
    return cached.result;
  }

  const fresh = await runFullDailyScan(request, userId, config);
  dailyCache.set(key, {
    generatedAtMs: Date.now(),
    result: fresh,
    scorerInputs: fresh.scorerInputs,
  });

  shortlistCache.delete(key);
  return fresh;
}

export async function getShortlistRefresh(
  request: Request,
  userId: string,
  refresh = false,
  configOverride?: Partial<StockEngineConfig>,
): Promise<ShortlistRefreshResult> {
  void request;
  const key = cacheKey(userId);
  const cachedShortlist = shortlistCache.get(key);
  if (!refresh && cachedShortlist && Date.now() - cachedShortlist.generatedAtMs < SHORTLIST_CACHE_TTL_MS) {
    return cachedShortlist.result;
  }

  let base = dailyCache.get(key);
  if (!base || Date.now() - base.generatedAtMs > DAILY_CACHE_TTL_MS) {
    await getDailyStockScan(request, userId, true, configOverride);
    base = dailyCache.get(key);
  }

  if (!base) {
    throw new Error('Unable to build shortlist without daily scan cache');
  }

  const config = { ...DEFAULT_CONFIG, ...(configOverride || {}) };
  const refreshed = await runShortlistRefresh(userId, base, config);
  shortlistCache.set(key, { generatedAtMs: Date.now(), result: refreshed });
  return refreshed;
}


