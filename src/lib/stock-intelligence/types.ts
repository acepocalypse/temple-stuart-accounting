export type MarketRegime = 'STRONG' | 'NEUTRAL' | 'WEAK';

export interface EngineConfig {
  minDollarVolume20d: number;
  earningsBlackoutTradingDays: number;
  earningsUnknownConfidencePenalty: number;
  universeTargetSize: number;
  shortlistTargetMin: number;
  shortlistTargetMax: number;
  selectionPoolMultiplier: number;
  expansionEnabled: boolean;
  expansionBufferPoints: number;
  pillarCutoff: number;
  pillarWeights: {
    volEdge: number;
    quality: number;
    regime: number;
    infoEdge: number;
  };
  confidenceBuckets: {
    elite: number;
    high: number;
    moderate: number;
  };
}

export interface Candle {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalsLite {
  sector: string | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  roe: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  operatingMargin: number | null;
}

export interface EarningsInfo {
  date: string | null;
  tradingDaysAway: number | null;
  inBlackoutWindow: boolean;
  isUnknown: boolean;
}

export interface NewsSnapshot {
  sentimentDirection: 'IMPROVING' | 'FLAT' | 'DETERIORATING';
  intensityRatio: number;
  divergence: boolean;
  headlineCount7d: number;
  headlineCountBaseline: number;
}

export interface StockFeatures {
  ticker: string;
  price: number;
  sector: string | null;
  dollarVolume20d: number;
  volumeVs20d: number;
  priceAbove20dma: boolean;
  priceAbove50dma: boolean;
  priceAbove200dma: boolean;
  slope50dma: number;
  higherHighHigherLow: boolean;
  rsi14: number | null;
  roc20: number | null;
  atr14Pct: number | null;
  realizedVol20d: number | null;
  bbWidth: number | null;
  bbWidthPctRankish: number | null;
  breakoutVolume: boolean;
  spyCorrelation60d: number | null;
  betaProxy60d: number | null;
  fundamentals: FundamentalsLite;
  earnings: EarningsInfo;
  news: NewsSnapshot;
}

export interface MacroSnapshot {
  regime: MarketRegime;
  score: number;
  spyAbove200dma: boolean;
  vix: number | null;
  ratesTrendUp: boolean | null;
  inflationTrendDown: boolean | null;
  unemploymentTrendDown: boolean | null;
}

export interface PillarScores {
  volEdge: number;
  quality: number;
  regime: number;
  infoEdge: number;
}

export interface AdaptiveThresholdResult {
  threshold: number;
  percentileTarget: number;
  floor: number;
  mean: number;
  std: number;
}

export interface ConfidenceResult {
  score: number;
  label: 'ELITE' | 'HIGH' | 'MODERATE' | 'WATCH';
}

export interface TradePlan {
  strategy: 'BREAK_ABOVE_PRIOR_15M_SWING_HIGH';
  triggerDescription: string;
  triggerPrice: number;
  stopDescription: string;
  stopPrice: number;
  status: 'ACTIONABLE' | 'WATCH_ONLY';
  volumeConfirmed: boolean;
  atr14: number | null;
  distanceTo20dmaPct: number | null;
  daily20dma: number | null;
  recent15mSwingHigh: number | null;
  recent15mSwingLow: number | null;
  entryTo20dmaDistancePct: number | null;
  riskPerShare: number;
  oneR: number;
  twoR: number;
}

export interface TradeCard {
  ticker: string;
  sector: string | null;
  liquidityRank: number;
  status: 'ACTIONABLE' | 'WATCH_ONLY';
  manuallyPromoted?: boolean;
  price: number;
  regime: MarketRegime;
  pillars: PillarScores;
  overallScore: number;
  adaptiveThreshold: number;
  percentileRank: number;
  convergence: {
    met: boolean;
    pillarsAboveCutoff: number;
    cutoff: number;
    strength: 'STRONG' | 'PASS' | 'FAIL';
  };
  confidence: ConfidenceResult;
  plainEnglish: string | null;
  why: string[];
  riskWarnings: string[];
  plan: TradePlan | null;
  blocked: boolean;
  blockedReason: string | null;
  freshness: {
    daily: string | null;
    intraday15m: string | null;
    fundamentals: string | null;
    earnings: string | null;
    macro: string | null;
    news: string | null;
  };
  generatedAt: string;
}

export interface ScanDiagnostics {
  errors: string[];
  fetchGaps: string[];
  providerFailures: string[];
  runtimeMs: number;
}

export interface DailyScanSummary {
  scannerSymbols: number;
  filteredByPriceLiquidity: number;
  scoredUniverse: number;
  threshold: number;
  shortlisted: number;
  returnedCards: number;
  noSetups: boolean;
}

export interface ScanDebug {
  regime_label: MarketRegime;
  adaptive_threshold: number;
  universe_count: number;
  valid_daily_count: number;
  valid_15m_count: number;
  blocked_earnings_count: number;
  earnings_unknown_count: number;
  convergence_pass_count: number;
  threshold_pass_count: number;
  top10_scores: number[];
}

export interface DailyScanResult {
  generatedAt: string;
  regime: MacroSnapshot;
  summary: DailyScanSummary;
  scan_debug: ScanDebug;
  cards: TradeCard[];
  watchlist: TradeCard[];
  diagnostics: ScanDiagnostics;
}

export interface RefreshSummary {
  sourceDailyScanAt: string;
  refreshedSymbols: number;
  returnedCards: number;
}

export interface RefreshResult {
  generatedAt: string;
  summary: RefreshSummary;
  cards: TradeCard[];
  watchlist: TradeCard[];
  diagnostics: ScanDiagnostics;
}

export interface OpenPosition {
  ticker: string;
  entry: number;
  stop: number;
  openedAt: string;
}

export interface ApprovalLog {
  id: string;
  ticker: string;
  approvedAt: string;
  plan: TradePlan;
  note: string | null;
  status: 'OPEN' | 'CLOSED';
}
