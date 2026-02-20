import { GoogleGenAI } from '@google/genai';
import type { TradeCard } from '../types';

const GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
const MAX_REQUESTS_PER_MIN = 50;

const requestTimestamps: number[] = [];
const responseCache = new Map<string, { expiresAt: number; text: string }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
let geminiClient: GoogleGenAI | null = null;

function cleanWindow(nowMs: number): void {
  while (requestTimestamps.length > 0 && nowMs - requestTimestamps[0] >= 60_000) {
    requestTimestamps.shift();
  }
}

async function waitForRateWindow(): Promise<void> {
  while (true) {
    const nowMs = Date.now();
    cleanWindow(nowMs);
    if (requestTimestamps.length < MAX_REQUESTS_PER_MIN) {
      requestTimestamps.push(nowMs);
      return;
    }
    const oldest = requestTimestamps[0];
    const waitMs = Math.max(100, 60_000 - (nowMs - oldest));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function summarizeFallback(card: TradeCard): string {
  const clue = card.why[0] || 'Momentum and trend are aligning.';
  const watchFor = card.riskWarnings[0] || 'Watch for a failed breakout and quick fade.';
  if (!card.plan) {
    return `${card.ticker} is watch-only for now, so wait and watch for cleaner confirmation before acting. Clue: ${clue} Watch for: ${watchFor}`;
  }
  return `${card.ticker} looks actionable: watch for strength through ${card.plan.triggerPrice}, then manage risk with a stop near ${card.plan.stopPrice} (risk/share ${card.plan.riskPerShare}). Clue: ${clue} Watch for: ${watchFor}`;
}

function cacheKey(card: TradeCard): string {
  return JSON.stringify({
    ticker: card.ticker,
    regime: card.regime,
    overall: card.overallScore,
    conf: card.confidence,
    why: card.why,
    risk: card.riskWarnings,
    plan: card.plan,
    blocked: card.blocked,
    reason: card.blockedReason,
  });
}

export async function generatePlainEnglishSummary(card: TradeCard): Promise<{
  text: string;
  error: string | null;
}> {
  const token =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GENAI_API_KEY ||
    process.env.RCAC_GENAI_API_KEY;
  if (!token) {
    return { text: summarizeFallback(card), error: 'GEMINI_API_KEY missing' };
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: token });
  }

  const key = cacheKey(card);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { text: cached.text, error: null };
  }

  const facts = {
    ticker: card.ticker,
    sector: card.sector,
    regime: card.regime,
    overallScore: card.overallScore,
    adaptiveThreshold: card.adaptiveThreshold,
    confidence: card.confidence,
    convergence: card.convergence,
    blocked: card.blocked,
    blockedReason: card.blockedReason,
    why: card.why,
    riskWarnings: card.riskWarnings,
    plan: card.plan,
  };

  const prompt =
    'Write exactly 2 concise sentences in plain English for a human trader. ' +
    'Use active verbs and clue-style language such as "watch for", "wait for", "avoid", "consider", "confirm". ' +
    'Keep tone practical and non-technical. ' +
    'Only use the provided FACTS, do not invent information, and do not provide financial advice. ' +
    'If blocked=true, sentence 1 must clearly say it is not eligible now and what to watch for next. ' +
    'If blocked=false, sentence 1 must include triggerPrice/stopPrice/riskPerShare from plan using action wording. ' +
    'Sentence 2 must give one clue and one risk warning from FACTS.';

  try {
    await waitForRateWindow();
    let output = '';
    let modelError: string | null = null;

    for (const model of GEMINI_MODELS) {
      try {
        const response = (await Promise.race([
          geminiClient.models.generateContent({
            model,
            contents:
              `${prompt}\n` +
              'System instruction: You are a strict fact-only trade card narrator.\n' +
              `FACTS:\n${JSON.stringify(facts)}`,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS),
          ),
        ])) as unknown as { text?: string };

        output = typeof response.text === 'string' ? response.text.trim() : '';
        if (output) break;
        modelError = `Gemini empty content for model ${model}`;
      } catch (error: unknown) {
        modelError = error instanceof Error ? error.message : String(error);
      }
    }

    const text = output || summarizeFallback(card);
    responseCache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
    return { text, error: output ? null : modelError || 'empty Gemini content' };
  } catch (error: unknown) {
    const message =
      error instanceof Error
          ? error.message
          : String(error);
    return { text: summarizeFallback(card), error: message };
  }
}
