import { NextResponse } from 'next/server';
import {
  listManualPromotions,
  promoteWatchlistTicker,
} from '@/lib/stock-intelligence/engine';
import type { DailyScanResult, RefreshResult, TradeCard } from '@/lib/stock-intelligence/types';

export const maxDuration = 30;

type PromoteSnapshot = Partial<DailyScanResult & RefreshResult> & {
  cards?: TradeCard[];
  watchlist?: TradeCard[];
};

function hasPromotionEligiblePlan(card: TradeCard): boolean {
  if (!card.plan) return false;
  return (
    Number.isFinite(card.plan.triggerPrice) &&
    Number.isFinite(card.plan.stopPrice) &&
    Number.isFinite(card.plan.riskPerShare) &&
    Number.isFinite(card.plan.oneR) &&
    Number.isFinite(card.plan.twoR)
  );
}

function promoteFromSnapshot(snapshot: PromoteSnapshot, ticker: string): PromoteSnapshot {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const watchlist = Array.isArray(snapshot.watchlist) ? snapshot.watchlist : [];
  const target = watchlist.find((c) => c.ticker.toUpperCase() === ticker);
  if (!target) {
    throw new Error(`Ticker ${ticker} is not in the current watchlist.`);
  }
  if (!hasPromotionEligiblePlan(target)) {
    throw new Error(`Ticker ${ticker} cannot be promoted without a valid trade plan.`);
  }

  const nextCards = [
    ...cards,
    {
      ...target,
      status: 'ACTIONABLE' as const,
      blocked: false,
      blockedReason: null,
      manuallyPromoted: true,
    },
  ];
  const nextWatch = watchlist.filter((c) => c.ticker.toUpperCase() !== ticker);
  const summary = (snapshot.summary || {}) as Record<string, unknown>;
  const returnedCards = typeof summary.returnedCards === 'number' ? Number(summary.returnedCards) : cards.length;
  const nextSummary = {
    ...summary,
    returnedCards: returnedCards + 1,
    noSetups: false,
  };

  return {
    ...snapshot,
    cards: nextCards,
    watchlist: nextWatch,
    summary: nextSummary as unknown as PromoteSnapshot['summary'],
  };
}

export async function GET() {
  return NextResponse.json({
    promotions: listManualPromotions('manual-stock-user'),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ticker = String(body.ticker || '').toUpperCase().trim();
    const snapshot = (body.snapshot || null) as PromoteSnapshot | null;
    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }
    let result: unknown;
    try {
      result = promoteWatchlistTicker(ticker, 'manual-stock-user');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Run a daily scan first')) {
        throw error;
      }
      if (!snapshot) {
        return NextResponse.json(
          {
            error:
              'Promotion session expired on this worker. Refresh shortlist and retry, or retry promotion from current results.',
          },
          { status: 409 },
        );
      }
      result = promoteFromSnapshot(snapshot, ticker);
    }
    return NextResponse.json({ ok: true, result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
