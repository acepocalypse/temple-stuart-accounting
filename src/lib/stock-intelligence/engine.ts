import { deriveConfidence, countPillarsAbove } from './confidence';
import { nowIso } from './dates';
import { DEFAULT_ENGINE_CONFIG } from './defaults';
import { buildStockFeatures } from './features';
import { percentileRank, round } from './math';
import { buildTriggerPlan, gapRiskProxy } from './plan';
import { fetchEarnings, fetchFundamentals, fetchNewsSnapshot } from './providers/finnhub';
import { fetchMacroSnapshot } from './providers/fred';
import { generatePlainEnglishSummary } from './providers/genai';
import { fetchYahooCandles } from './providers/yahoo';
import { getScanProgress, setScanProgress } from './progress';
import { scorePillars, overallScore } from './scoring';
import { listOpenPositions } from './storage';
import { computeAdaptiveThreshold } from './threshold';
import type {
  Candle,
  DailyScanResult,
  EngineConfig,
  MacroSnapshot,
  PillarScores,
  RefreshResult,
  StockFeatures,
  TradeCard,
} from './types';
import { getSeedUniverse } from './universe';

type EngineDeps = {
  fetchDailyCandles: typeof fetchYahooCandles;
  fetchIntradayCandles: typeof fetchYahooCandles;
  fetchFundamentals: typeof fetchFundamentals;
  fetchEarnings: typeof fetchEarnings;
  fetchNewsSnapshot: typeof fetchNewsSnapshot;
  fetchMacroSnapshot: typeof fetchMacroSnapshot;
};

type DailyFeatureRow = {
  ticker: string;
  dailyCandles: Candle[];
  dollarVolume20d: number;
  preScore: number;
  preFeatures: StockFeatures;
  liquidityRank: number;
};

type EvaluatedRow = {
  ticker: string;
  liquidityRank: number;
  dailyCandles: Candle[];
  intradayCandles: Candle[];
  features: StockFeatures;
  pillars: PillarScores;
  overall: number;
  freshness: TradeCard['freshness'];
};

type CachedDaily = {
  result: DailyScanResult;
  topSymbols: string[];
  metaByTicker: Map<
    string,
    {
      liquidityRank: number;
      dailyCandles: Candle[];
      features: StockFeatures;
      overall: number;
      pillars: PillarScores;
    }
  >;
  generatedAtMs: number;
};

const defaultDeps: EngineDeps = {
  fetchDailyCandles: fetchYahooCandles,
  fetchIntradayCandles: fetchYahooCandles,
  fetchFundamentals,
  fetchEarnings,
  fetchNewsSnapshot,
  fetchMacroSnapshot,
};

const dailyCache = new Map<string, CachedDaily>();
const refreshCache = new Map<string, { generatedAtMs: number; result: RefreshResult }>();
const DAILY_CACHE_MS = 24 * 60 * 60 * 1000;
const REFRESH_CACHE_MS = 10 * 60 * 1000;

function parseConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG, ...(overrides || {}) };
}

export function getDefaultConfig(): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG };
}

function pickReasons(features: StockFeatures, pillars: PillarScores, macro: MacroSnapshot): string[] {
  const reasons: string[] = [];
  if (features.priceAbove20dma && features.priceAbove50dma && features.priceAbove200dma) {
    reasons.push('Price is above 20/50/200DMA trend stack.');
  }
  if (features.higherHighHigherLow) {
    reasons.push('Higher-high/higher-low structure remains intact.');
  }
  if (features.breakoutVolume) {
    reasons.push(`Breakout volume confirmed at ${round(features.volumeVs20d, 2)}x 20-day average.`);
  }
  reasons.push(
    `Pillars -> Vol-Edge ${pillars.volEdge}, Quality ${pillars.quality}, Regime ${pillars.regime}, Info-Edge ${pillars.infoEdge}.`,
  );
  reasons.push(`Macro regime ${macro.regime} (${round(macro.score, 1)}).`);
  return reasons.slice(0, 5);
}

function pickWarnings(features: StockFeatures, macro: MacroSnapshot, dailyCandles: Candle[]): string[] {
  const warnings: string[] = [];
  if (features.earnings.inBlackoutWindow) {
    warnings.push(
      `Earnings within 2 trading days (${features.earnings.date || 'date unavailable'}): set to WATCH-ONLY.`,
    );
  } else if (features.earnings.isUnknown) {
    warnings.push('Earnings date missing/unknown: confidence penalized.');
  }
  if (macro.vix !== null && macro.vix > 30) {
    warnings.push(`VIX elevated at ${round(macro.vix, 1)}.`);
  }
  const gapRisk = gapRiskProxy(dailyCandles);
  if (gapRisk >= 25) {
    warnings.push(`Gap risk elevated (${gapRisk}% of last 30 sessions had >2.2% gap).`);
  }
  return warnings;
}

function noSetupResult(startMs: number, macro: MacroSnapshot, scanned: number): DailyScanResult {
  return {
    generatedAt: nowIso(),
    regime: macro,
    summary: {
      scannerSymbols: scanned,
      filteredByPriceLiquidity: 0,
      scoredUniverse: 0,
      threshold: 0,
      shortlisted: 0,
      returnedCards: 0,
      noSetups: true,
    },
    cards: [],
    watchlist: [],
    diagnostics: {
      errors: [],
      fetchGaps: ['No high-quality setups today.'],
      providerFailures: [],
      runtimeMs: Date.now() - startMs,
    },
  };
}

async function buildDailyFeatureRows(
  tickers: string[],
  config: EngineConfig,
  deps: EngineDeps,
  onTick?: (completed: number, total: number) => void,
): Promise<{ rows: DailyFeatureRow[]; spyCandles: Candle[]; errors: string[] }> {
  const errors: string[] = [];
  const spy = await deps.fetchDailyCandles('SPY', '1y', '1d');
  const spyCandles = spy.candles;
  const rows: Omit<DailyFeatureRow, 'liquidityRank'>[] = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    onTick?.(i + 1, tickers.length);
    const daily = await deps.fetchDailyCandles(ticker, '1y', '1d');
    if (daily.error || daily.candles.length < 220) {
      if (daily.error) errors.push(`${ticker}: ${daily.error}`);
      continue;
    }
    const base = buildStockFeatures({
      ticker,
      dailyCandles: daily.candles,
      spyCandles,
      fundamentals: {
        sector: null,
        marketCap: null,
        pe: null,
        eps: null,
        roe: null,
        currentRatio: null,
        debtToEquity: null,
        operatingMargin: null,
      },
      earnings: {
        date: null,
        tradingDaysAway: null,
        inBlackoutWindow: false,
        isUnknown: true,
      },
      news: {
        sentimentDirection: 'FLAT',
        intensityRatio: 1,
        divergence: false,
        headlineCount7d: 0,
        headlineCountBaseline: 0,
      },
    });
    if (!base || base.price <= 0) continue;
    if (base.dollarVolume20d < config.minDollarVolume20d) continue;

    const preMacro: MacroSnapshot = {
      regime: 'NEUTRAL',
      score: 50,
      spyAbove200dma: true,
      vix: null,
      ratesTrendUp: null,
      inflationTrendDown: null,
      unemploymentTrendDown: null,
    };
    const preScore = overallScore(scorePillars(base, preMacro), config.pillarWeights);
    rows.push({
      ticker,
      dailyCandles: daily.candles,
      dollarVolume20d: base.dollarVolume20d,
      preScore,
      preFeatures: base,
    });
  }

  rows.sort((a, b) => b.dollarVolume20d - a.dollarVolume20d);
  const ranked: DailyFeatureRow[] = rows.map((r, idx) => ({ ...r, liquidityRank: idx + 1 }));
  return { rows: ranked, spyCandles, errors };
}

async function narrateCards(cards: TradeCard[], providerFailures: string[]): Promise<TradeCard[]> {
  const out: TradeCard[] = [];
  for (const card of cards) {
    const summary = await generatePlainEnglishSummary(card);
    if (summary.error) providerFailures.push(`${card.ticker} genai: ${summary.error}`);
    out.push({ ...card, plainEnglish: summary.text });
  }
  return out;
}

function makeCard(args: {
  row: EvaluatedRow;
  threshold: number;
  percentileRankValue: number;
  macro: MacroSnapshot;
  config: EngineConfig;
}): TradeCard {
  const { row, threshold, percentileRankValue, macro, config } = args;
  const pillarsAbove = countPillarsAbove(row.pillars, config.pillarCutoff);
  const convergenceMet = pillarsAbove >= 3;
  const convergenceStrength =
    pillarsAbove >= 4 ? 'STRONG' : pillarsAbove >= 3 ? 'PASS' : 'FAIL';

  const watchReason = row.features.earnings.inBlackoutWindow
    ? 'Earnings window too close'
    : !convergenceMet
      ? 'Convergence gate failed'
      : null;
  const plan = buildTriggerPlan({
    intraday15m: row.intradayCandles,
    dailyCandles: row.dailyCandles,
    allowEntry: convergenceMet && !row.features.earnings.inBlackoutWindow,
    watchReason,
  });

  const sentimentBonus =
    row.features.news.sentimentDirection === 'IMPROVING'
      ? 1
      : row.features.news.sentimentDirection === 'DETERIORATING'
        ? -1
        : 0;
  const baseConfidence = deriveConfidence({
    pillars: row.pillars,
    overall: row.overall,
    threshold,
    macro,
    config,
    sentimentBonus,
  });
  const confidencePenalty = row.features.earnings.isUnknown
    ? config.earningsUnknownConfidencePenalty
    : 0;
  const adjustedConfidence = Math.max(0, baseConfidence.score - confidencePenalty);

  const warnings = pickWarnings(row.features, macro, row.dailyCandles);
  const status: TradeCard['status'] =
    plan && plan.status === 'ACTIONABLE' && row.overall >= threshold
      ? 'ACTIONABLE'
      : 'WATCH_ONLY';

  return {
    ticker: row.ticker,
    sector: row.features.sector,
    liquidityRank: row.liquidityRank,
    status,
    price: row.features.price,
    regime: macro.regime,
    pillars: row.pillars,
    overallScore: row.overall,
    adaptiveThreshold: threshold,
    percentileRank: percentileRankValue,
    convergence: {
      met: convergenceMet,
      pillarsAboveCutoff: pillarsAbove,
      cutoff: config.pillarCutoff,
      strength: convergenceStrength,
    },
    confidence: {
      score: round(adjustedConfidence, 2),
      label:
        adjustedConfidence >= config.confidenceBuckets.elite
          ? 'ELITE'
          : adjustedConfidence >= config.confidenceBuckets.high
            ? 'HIGH'
            : adjustedConfidence >= config.confidenceBuckets.moderate
              ? 'MODERATE'
              : 'WATCH',
    },
    plainEnglish: null,
    why: pickReasons(row.features, row.pillars, macro),
    riskWarnings: warnings,
    plan,
    blocked: status === 'WATCH_ONLY',
    blockedReason: status === 'WATCH_ONLY' ? watchReason || 'Trigger not confirmed' : null,
    freshness: row.freshness,
    generatedAt: nowIso(),
  };
}

function partitionCards(cards: TradeCard[]): { cards: TradeCard[]; watchlist: TradeCard[] } {
  const sorted = [...cards].sort((a, b) => b.overallScore - a.overallScore);
  return {
    cards: sorted.filter((c) => c.status === 'ACTIONABLE'),
    watchlist: sorted.filter((c) => c.status !== 'ACTIONABLE'),
  };
}

function adaptivePool(cards: TradeCard[], threshold: number, config: EngineConfig): TradeCard[] {
  const poolCap = Math.max(
    config.shortlistTargetMax,
    config.shortlistTargetMax * Math.max(1, config.selectionPoolMultiplier),
  );
  const strict = cards.filter((c) => c.overallScore >= threshold);
  const minPool = Math.max(config.shortlistTargetMax, config.shortlistTargetMin);
  if (!config.expansionEnabled || strict.length >= minPool) {
    return strict.sort((a, b) => b.overallScore - a.overallScore).slice(0, poolCap);
  }
  const relaxed = cards.filter(
    (c) => c.overallScore >= Math.max(0, threshold - config.expansionBufferPoints),
  );
  return relaxed.sort((a, b) => b.overallScore - a.overallScore).slice(0, poolCap);
}

export async function runDailyScan(
  userKey = 'manual-stock-user',
  refresh = false,
  overrides?: Partial<EngineConfig>,
  deps: EngineDeps = defaultDeps,
): Promise<DailyScanResult> {
  const config = parseConfig(overrides);
  const startMs = Date.now();
  const cached = dailyCache.get(userKey);
  if (!refresh && cached && Date.now() - cached.generatedAtMs < DAILY_CACHE_MS) {
    return cached.result;
  }

  setScanProgress(userKey, {
    running: true,
    phase: 'loading_daily_candles',
    startedAt: nowIso(),
    completed: 0,
    total: config.universeTargetSize,
    message: 'Loading daily candles',
  });

  const tickers = getSeedUniverse(config.universeTargetSize);
  const { rows, spyCandles, errors } = await buildDailyFeatureRows(
    tickers,
    config,
    deps,
    (completed, total) =>
      setScanProgress(userKey, {
        running: true,
        phase: 'loading_daily_candles',
        completed,
        total,
        message: `Daily candles ${completed}/${total}`,
      }),
  );

  if (rows.length === 0) {
    const macro: MacroSnapshot = {
      regime: 'NEUTRAL',
      score: 50,
      spyAbove200dma: false,
      vix: null,
      ratesTrendUp: null,
      inflationTrendDown: null,
      unemploymentTrendDown: null,
    };
    return noSetupResult(startMs, macro, tickers.length);
  }

  const spyClose = spyCandles[spyCandles.length - 1]?.close ?? 0;
  const spySma50 =
    spyCandles.length >= 50
      ? spyCandles.slice(-50).reduce((sum, c) => sum + c.close, 0) / 50
      : spyClose;
  const vixData = await deps.fetchDailyCandles('^VIX', '1y', '1d');
  const vix = vixData.candles[vixData.candles.length - 1]?.close ?? null;
  const macroResp = await deps.fetchMacroSnapshot(spyClose > spySma50, vix);
  const macro = macroResp.data;

  const stage1 = [...rows].sort((a, b) => b.preScore - a.preScore).slice(0, 60);
  setScanProgress(userKey, {
    running: true,
    phase: 'enriching_candidates',
    completed: 0,
    total: stage1.length,
    message: `Enriching ${stage1.length} candidates`,
  });

  const providerFailures: string[] = [];
  const evaluated: EvaluatedRow[] = [];
  for (let i = 0; i < stage1.length; i++) {
    const row = stage1[i];
    const [fundamentals, earnings, news, intraday] = await Promise.all([
      deps.fetchFundamentals(row.ticker),
      deps.fetchEarnings(row.ticker),
      deps.fetchNewsSnapshot(row.ticker),
      deps.fetchIntradayCandles(row.ticker, '1mo', '15m'),
    ]);
    setScanProgress(userKey, {
      running: true,
      phase: 'enriching_candidates',
      completed: i + 1,
      total: stage1.length,
      message: `Enriched ${i + 1}/${stage1.length}`,
    });

    if (intraday.error || intraday.candles.length < 20) {
      providerFailures.push(`${row.ticker} intraday unavailable`);
      continue;
    }
    if (fundamentals.error) providerFailures.push(`${row.ticker} fundamentals: ${fundamentals.error}`);
    if (earnings.error) providerFailures.push(`${row.ticker} earnings: ${earnings.error}`);
    if (news.error) providerFailures.push(`${row.ticker} news: ${news.error}`);

    const features = buildStockFeatures({
      ticker: row.ticker,
      dailyCandles: row.dailyCandles,
      spyCandles,
      fundamentals: fundamentals.data,
      earnings: earnings.data,
      news: news.data,
    });
    if (!features) continue;
    const pillars = scorePillars(features, macro);
    const overall = overallScore(pillars, config.pillarWeights);
    evaluated.push({
      ticker: row.ticker,
      liquidityRank: row.liquidityRank,
      dailyCandles: row.dailyCandles,
      intradayCandles: intraday.candles,
      features,
      pillars,
      overall,
      freshness: {
        daily: nowIso(),
        intraday15m: nowIso(),
        fundamentals: fundamentals.freshness,
        earnings: earnings.freshness,
        macro: macroResp.freshness,
        news: news.freshness,
      },
    });
  }

  if (evaluated.length === 0) {
    return noSetupResult(startMs, macro, tickers.length);
  }

  const scores = evaluated.map((e) => e.overall);
  const adaptive = computeAdaptiveThreshold(scores, macro.regime);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const cards = evaluated.map((row) =>
    makeCard({
      row,
      threshold: adaptive.threshold,
      percentileRankValue: percentileRank(sortedScores, row.overall),
      macro,
      config,
    }),
  );

  const pool = adaptivePool(cards, adaptive.threshold, config);
  if (pool.length === 0) {
    const result: DailyScanResult = {
      generatedAt: nowIso(),
      regime: macro,
      summary: {
        scannerSymbols: tickers.length,
        filteredByPriceLiquidity: rows.length,
        scoredUniverse: evaluated.length,
        threshold: round(adaptive.threshold, 2),
        shortlisted: 0,
        returnedCards: 0,
        noSetups: true,
      },
      cards: [],
      watchlist: [],
      diagnostics: {
        errors,
        fetchGaps: ['No high-quality setups today.'],
        providerFailures,
        runtimeMs: Date.now() - startMs,
      },
    };
    dailyCache.set(userKey, {
      result,
      topSymbols: [],
      metaByTicker: new Map(),
      generatedAtMs: Date.now(),
    });
    return result;
  }

  const partitioned = partitionCards(pool);
  setScanProgress(userKey, {
    running: true,
    phase: 'generating_narratives',
    completed: 0,
    total: partitioned.cards.length + partitioned.watchlist.length,
    message: 'Generating plain-English summaries',
  });
  const narratedCards = await narrateCards(partitioned.cards, providerFailures);
  setScanProgress(userKey, {
    running: true,
    phase: 'generating_narratives',
    completed: narratedCards.length,
    total: partitioned.cards.length + partitioned.watchlist.length,
    message: `Narrated ${narratedCards.length}/${partitioned.cards.length + partitioned.watchlist.length}`,
  });
  const narratedWatch = await narrateCards(partitioned.watchlist, providerFailures);

  const result: DailyScanResult = {
    generatedAt: nowIso(),
    regime: macro,
    summary: {
      scannerSymbols: tickers.length,
      filteredByPriceLiquidity: rows.length,
      scoredUniverse: evaluated.length,
      threshold: round(adaptive.threshold, 2),
      shortlisted: pool.length,
      returnedCards: narratedCards.length,
      noSetups: narratedCards.length === 0,
    },
    cards: narratedCards.slice(0, config.shortlistTargetMax),
    watchlist: narratedWatch,
    diagnostics: {
      errors,
      fetchGaps: narratedCards.length === 0 ? ['No high-quality setups today.'] : [],
      providerFailures,
      runtimeMs: Date.now() - startMs,
    },
  };

  dailyCache.set(userKey, {
    result,
    topSymbols: pool.map((c) => c.ticker),
    metaByTicker: new Map(
      evaluated.map((e) => [
        e.ticker,
        {
          liquidityRank: e.liquidityRank,
          dailyCandles: e.dailyCandles,
          features: e.features,
          overall: e.overall,
          pillars: e.pillars,
        },
      ]),
    ),
    generatedAtMs: Date.now(),
  });
  refreshCache.delete(userKey);
  setScanProgress(userKey, {
    running: false,
    phase: 'complete',
    completed: 1,
    total: 1,
    message: 'Daily scan complete',
  });
  return result;
}

export function getDailyScanProgress(userKey = 'manual-stock-user') {
  return getScanProgress(userKey);
}

export async function runIntradayRefresh(
  userKey = 'manual-stock-user',
  refresh = false,
  overrides?: Partial<EngineConfig>,
  deps: EngineDeps = defaultDeps,
): Promise<RefreshResult> {
  const config = parseConfig(overrides);
  const startMs = Date.now();
  const cached = refreshCache.get(userKey);
  if (!refresh && cached && Date.now() - cached.generatedAtMs < REFRESH_CACHE_MS) {
    return cached.result;
  }

  let base = dailyCache.get(userKey);
  if (!base || Date.now() - base.generatedAtMs > DAILY_CACHE_MS) {
    await runDailyScan(userKey, true, overrides, deps);
    base = dailyCache.get(userKey);
  }
  if (!base) throw new Error('Missing base daily scan for refresh');

  const openSymbols = listOpenPositions().map((p) => p.ticker.toUpperCase());
  const symbols = Array.from(new Set([...base.topSymbols, ...openSymbols]));
  const providerFailures: string[] = [];
  const cards: TradeCard[] = [];

  for (const symbol of symbols) {
    const meta = base.metaByTicker.get(symbol);
    if (!meta) continue;
    const intraday = await deps.fetchIntradayCandles(symbol, '1mo', '15m');
    if (intraday.error || intraday.candles.length < 20) {
      providerFailures.push(`${symbol} intraday unavailable`);
      continue;
    }
    const watchReason = meta.features.earnings.inBlackoutWindow
      ? 'Earnings window too close'
      : null;
    const plan = buildTriggerPlan({
      intraday15m: intraday.candles,
      dailyCandles: meta.dailyCandles,
      allowEntry:
        countPillarsAbove(meta.pillars, config.pillarCutoff) >= 3 &&
        !meta.features.earnings.inBlackoutWindow,
      watchReason,
    });
    const warnings = pickWarnings(meta.features, base.result.regime, meta.dailyCandles);
    cards.push({
      ticker: symbol,
      sector: meta.features.sector,
      liquidityRank: meta.liquidityRank,
      status:
        plan && plan.status === 'ACTIONABLE' && meta.overall >= base.result.summary.threshold
          ? 'ACTIONABLE'
          : 'WATCH_ONLY',
      price: meta.features.price,
      regime: base.result.regime.regime,
      pillars: meta.pillars,
      overallScore: meta.overall,
      adaptiveThreshold: base.result.summary.threshold,
      percentileRank: 0,
      convergence: {
        met: countPillarsAbove(meta.pillars, config.pillarCutoff) >= 3,
        pillarsAboveCutoff: countPillarsAbove(meta.pillars, config.pillarCutoff),
        cutoff: config.pillarCutoff,
        strength:
          countPillarsAbove(meta.pillars, config.pillarCutoff) >= 4
            ? 'STRONG'
            : countPillarsAbove(meta.pillars, config.pillarCutoff) >= 3
              ? 'PASS'
              : 'FAIL',
      },
      confidence: deriveConfidence({
        pillars: meta.pillars,
        overall: meta.overall,
        threshold: base.result.summary.threshold,
        macro: base.result.regime,
        config,
        sentimentBonus:
          meta.features.news.sentimentDirection === 'IMPROVING'
            ? 1
            : meta.features.news.sentimentDirection === 'DETERIORATING'
              ? -1
              : 0,
      }),
      plainEnglish: null,
      why: pickReasons(meta.features, meta.pillars, base.result.regime),
      riskWarnings: warnings,
      plan,
      blocked: !plan || plan.status !== 'ACTIONABLE',
      blockedReason: !plan || plan.status !== 'ACTIONABLE' ? watchReason || 'Trigger not confirmed' : null,
      freshness: {
        daily: base.result.generatedAt,
        intraday15m: nowIso(),
        fundamentals: null,
        earnings: null,
        macro: base.result.generatedAt,
        news: null,
      },
      generatedAt: nowIso(),
    });
  }

  const partitioned = partitionCards(cards);
  const narratedCards = await narrateCards(partitioned.cards, providerFailures);
  const narratedWatch = await narrateCards(partitioned.watchlist, providerFailures);

  const result: RefreshResult = {
    generatedAt: nowIso(),
    summary: {
      sourceDailyScanAt: base.result.generatedAt,
      refreshedSymbols: symbols.length,
      returnedCards: narratedCards.length,
    },
    cards: narratedCards.slice(0, config.shortlistTargetMax),
    watchlist: narratedWatch,
    diagnostics: {
      errors: [],
      fetchGaps: [],
      providerFailures,
      runtimeMs: Date.now() - startMs,
    },
  };
  refreshCache.set(userKey, { generatedAtMs: Date.now(), result });
  return result;
}

export const testables = {
  buildDailyFeatureRows,
  parseConfig,
  _cache: {
    clear: () => {
      dailyCache.clear();
      refreshCache.clear();
    },
  },
};
