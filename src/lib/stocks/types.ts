import type { CandleData, TTScannerData } from '@/lib/convergence/types';
import type { FullScoringResult } from '@/lib/convergence/composite';

export interface StockEngineConfig {
  accountSize: number;
  riskPerTradePct: number;
  maxCapitalPerPositionPct: number;
  maxOpenPositions: number;
  maxPerSector: number;
  minPrice: number;
  maxPrice: number;
  minShortPrice: number;
  earningsBlackoutDays: number;
  topUniverseSize: number;
  scoringShortlistSize: number;
  intradayShortlistSize: number;
}

export interface ScannerMetricExtended extends TTScannerData {
  lastPrice: number | null;
  dayVolume: number | null;
  dollarVolume: number | null;
}

export interface DailyIndicators {
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  atr14: number | null;
}

export interface IntradayIndicators {
  close: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  atr14: number | null;
  upperBand: number | null;
  lowerBand: number | null;
  avgVolume20: number | null;
  lastVolume: number | null;
}

export type SetupType = 'Breakout' | 'Pullback' | 'Mean Reversion' | 'None';
export type TradeDirection = 'LONG' | 'SHORT' | 'WATCH';

export interface TriggerDecision {
  setupType: SetupType;
  direction: TradeDirection;
  triggerScore: number;
  notes: string[];
}

export interface PositionPlan {
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskPerShare: number | null;
  riskRewardToT1: number | null;
  riskRewardToT2: number | null;
  stopPct: number | null;
  maxRiskDollars: number;
  maxCapitalDollars: number;
  shares: number;
  notional: number;
  holdDays: number;
}

export interface StockTradeCard {
  symbol: string;
  sector: string | null;
  direction: TradeDirection;
  setupType: SetupType;
  score: number;
  dailyBiasScore: number;
  triggerScore: number;
  convergence: string;
  generatedAt: string;
  plan: PositionPlan;
  keyStats: {
    price: number | null;
    ivRank: number | null;
    ivHvSpread: number | null;
    hv30: number | null;
    liquidity: number | null;
    marketCap: number | null;
    earningsInDays: number | null;
    vix: number | null;
  };
  categoryScores: {
    volEdge: number;
    quality: number;
    regime: number;
    infoEdge: number;
  };
  explanations: string[];
  riskFlags: string[];
}

export interface ScoredUniverseRow {
  symbol: string;
  sector: string | null;
  lastPrice: number | null;
  dayVolume: number | null;
  dollarVolume: number | null;
  dailyBiasScore: number;
  dailyBiasDirection: TradeDirection;
  setupTypeHint: SetupType;
  ivRank: number | null;
  ivHvSpread: number | null;
  liquidity: number | null;
  marketCap: number | null;
  earningsInDays: number | null;
}

export interface DailyScanResult {
  generatedAt: string;
  config: StockEngineConfig;
  summary: {
    scannerSymbols: number;
    preFiltered: number;
    priceFiltered: number;
    finalUniverse: number;
    scoredWithConvergence: number;
    intradayEvaluated: number;
    openPositions: number;
    availableSlots: number;
    selectedCards: number;
  };
  cards: StockTradeCard[];
  watchlist: StockTradeCard[];
  universe: ScoredUniverseRow[];
  diagnostics: {
    errors: string[];
    fetchGaps: string[];
    runtimeMs: number;
  };
}

export interface CachedDailyScan {
  generatedAtMs: number;
  result: DailyScanResult;
  scorerInputs: Array<{
    symbol: string;
    scanner: ScannerMetricExtended;
    dailyCandles: CandleData[];
    scoring: FullScoringResult;
  }>;
}

export interface ShortlistRefreshResult {
  generatedAt: string;
  summary: {
    sourceDailyScanAt: string;
    refreshedSymbols: number;
    selectedCards: number;
    openPositions: number;
    availableSlots: number;
    runtimeMs: number;
  };
  cards: StockTradeCard[];
  watchlist: StockTradeCard[];
  diagnostics: {
    errors: string[];
    fetchGaps: string[];
  };
}
