import { GoogleGenAI } from '@google/genai';
import type { TradeCard } from '../types';

const GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
const MAX_REQUESTS_PER_MIN = 50;
const BATCH_SIZE = 12;
const MAX_RATE_WAIT_MS = 3_000;

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
  const nowMs = Date.now();
  cleanWindow(nowMs);
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MIN) {
    const oldest = requestTimestamps[0];
    const waitMs = Math.max(100, 60_000 - (nowMs - oldest));
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, MAX_RATE_WAIT_MS)));
  }
  requestTimestamps.push(Date.now());
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

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function generateBatch(chunk: TradeCard[]): Promise<{
  byTicker: Map<string, { text: string; error: string | null }>;
  batchError: string | null;
}> {
  const byTicker = new Map<string, { text: string; error: string | null }>();
  const token =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GENAI_API_KEY ||
    process.env.RCAC_GENAI_API_KEY;
  if (!token) {
    for (const card of chunk) {
      byTicker.set(card.ticker, {
        text: summarizeFallback(card),
        error: 'GEMINI_API_KEY missing',
      });
    }
    return { byTicker, batchError: 'GEMINI_API_KEY missing' };
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: token });
  }

  const facts = chunk.map((card) => ({
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
  }));

  const prompt =
    'Create exactly two concise practical sentences per ticker from FACTS. ' +
    'Use only FACTS, no inventions, no advice language. ' +
    'Return strict JSON array only: [{"ticker":"...","summary":"..."}]. ' +
    'Summary rules: if blocked=true sentence 1 says not eligible now and what to watch for next; ' +
    'if blocked=false sentence 1 includes triggerPrice/stopPrice/riskPerShare from plan. ' +
    'Sentence 2 must include one clue and one risk warning from FACTS.';

  try {
    await waitForRateWindow();
    let modelError: string | null = null;
    let parsed: Array<{ ticker: string; summary: string }> = [];

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

        const raw = typeof response.text === 'string' ? response.text : '';
        const cleaned = stripCodeFences(raw);
        const data = JSON.parse(cleaned) as Array<{ ticker?: unknown; summary?: unknown }>;
        if (!Array.isArray(data)) {
          modelError = `Gemini non-array JSON for model ${model}`;
          continue;
        }
        parsed = data
          .filter((row) => typeof row.ticker === 'string' && typeof row.summary === 'string')
          .map((row) => ({ ticker: String(row.ticker).toUpperCase(), summary: String(row.summary).trim() }))
          .filter((row) => row.summary.length > 0);
        if (parsed.length > 0) break;
        modelError = `Gemini empty JSON rows for model ${model}`;
      } catch (error: unknown) {
        modelError = error instanceof Error ? error.message : String(error);
      }
    }

    const parsedMap = new Map(parsed.map((row) => [row.ticker, row.summary]));
    for (const card of chunk) {
      const generated = parsedMap.get(card.ticker.toUpperCase()) || '';
      const text = generated || summarizeFallback(card);
      const error = generated ? null : modelError || 'empty Gemini content';
      byTicker.set(card.ticker, { text, error });
      responseCache.set(cacheKey(card), { text, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return { byTicker, batchError: modelError };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    for (const card of chunk) {
      const text = summarizeFallback(card);
      byTicker.set(card.ticker, { text, error: message });
      responseCache.set(cacheKey(card), { text, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return { byTicker, batchError: message };
  }
}

export async function generatePlainEnglishSummaries(cards: TradeCard[]): Promise<{
  byTicker: Map<string, { text: string; error: string | null }>;
}> {
  const byTicker = new Map<string, { text: string; error: string | null }>();
  if (cards.length === 0) return { byTicker };

  const pending: TradeCard[] = [];
  for (const card of cards) {
    const cached = responseCache.get(cacheKey(card));
    if (cached && cached.expiresAt > Date.now()) {
      byTicker.set(card.ticker, { text: cached.text, error: null });
    } else {
      pending.push(card);
    }
  }

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const batch = await generateBatch(chunk);
    for (const [ticker, value] of batch.byTicker) {
      byTicker.set(ticker, value);
    }
  }
  return { byTicker };
}

export async function generatePlainEnglishSummary(card: TradeCard): Promise<{
  text: string;
  error: string | null;
}> {
  const result = await generatePlainEnglishSummaries([card]);
  const picked = result.byTicker.get(card.ticker);
  if (picked) return picked;
  return { text: summarizeFallback(card), error: 'narration mapping missing' };
}
