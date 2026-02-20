import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ActionableItem } from './diff';

export interface SchedulerState {
  version: 1;
  lastDailyRunMarketDate: string | null;
  lastRefreshSlotKey: string | null;
  lastActionableSnapshot: ActionableItem[] | null;
  fallbackActive: boolean;
  fallbackEnteredAt: string | null;
  lastFallbackRescanAt: string | null;
  lastNotifiedByKey: Record<string, string>;
}

export const DEFAULT_SCHEDULER_STATE: SchedulerState = {
  version: 1,
  lastDailyRunMarketDate: null,
  lastRefreshSlotKey: null,
  lastActionableSnapshot: null,
  fallbackActive: false,
  fallbackEnteredAt: null,
  lastFallbackRescanAt: null,
  lastNotifiedByKey: {},
};

export async function loadSchedulerState(path: string): Promise<SchedulerState> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SchedulerState>;
    if (parsed.version !== 1) return { ...DEFAULT_SCHEDULER_STATE };
    return {
      ...DEFAULT_SCHEDULER_STATE,
      ...parsed,
      lastNotifiedByKey: parsed.lastNotifiedByKey || {},
    };
  } catch {
    return { ...DEFAULT_SCHEDULER_STATE };
  }
}

export async function saveSchedulerState(path: string, state: SchedulerState): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, path);
}

export function shouldThrottleNotification(
  state: SchedulerState,
  key: string,
  nowIso: string,
  cooldownMs = 30 * 60_000,
): boolean {
  const prev = state.lastNotifiedByKey[key];
  if (!prev) return false;
  const prevMs = Date.parse(prev);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(prevMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - prevMs < cooldownMs;
}

export function markNotification(state: SchedulerState, key: string, nowIso: string): SchedulerState {
  return {
    ...state,
    lastNotifiedByKey: {
      ...state.lastNotifiedByKey,
      [key]: nowIso,
    },
  };
}
