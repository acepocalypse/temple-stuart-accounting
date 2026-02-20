import type { TradeCard } from '../types';

export interface ActionableItem {
  ticker: string;
  score: number;
  triggerPrice: number | null;
}

export interface ActionableDiff {
  added: ActionableItem[];
  removed: ActionableItem[];
  updated: ActionableItem[];
  hasChanges: boolean;
}

export function snapshotActionable(cards: TradeCard[]): ActionableItem[] {
  return cards
    .map((card) => ({
      ticker: card.ticker.toUpperCase(),
      score: Math.round(card.overallScore * 100) / 100,
      triggerPrice: card.plan ? card.plan.triggerPrice : null,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function diffActionable(
  previous: ActionableItem[] | null,
  current: ActionableItem[],
): ActionableDiff {
  const prevMap = new Map((previous || []).map((x) => [x.ticker, x]));
  const curMap = new Map(current.map((x) => [x.ticker, x]));

  const added: ActionableItem[] = [];
  const removed: ActionableItem[] = [];
  const updated: ActionableItem[] = [];

  for (const item of current) {
    const prev = prevMap.get(item.ticker);
    if (!prev) {
      added.push(item);
      continue;
    }
    const changed =
      prev.score !== item.score ||
      (prev.triggerPrice ?? null) !== (item.triggerPrice ?? null);
    if (changed) {
      updated.push(item);
    }
  }
  for (const item of previous || []) {
    if (!curMap.has(item.ticker)) removed.push(item);
  }

  return {
    added,
    removed,
    updated,
    hasChanges: added.length > 0 || removed.length > 0 || updated.length > 0,
  };
}
