export type ScanPhase =
  | 'idle'
  | 'loading_daily_candles'
  | 'enriching_candidates'
  | 'generating_narratives'
  | 'complete'
  | 'error';

export interface ScanProgress {
  running: boolean;
  phase: ScanPhase;
  completed: number;
  total: number;
  startedAt: string | null;
  updatedAt: string;
  message: string;
}

const progressMap = new Map<string, ScanProgress>();
type ProgressStore = Map<string, ScanProgress>;
const globalScope = globalThis as typeof globalThis & {
  __stockScanProgressStore?: ProgressStore;
};
const sharedStore: ProgressStore =
  globalScope.__stockScanProgressStore || new Map<string, ScanProgress>();
globalScope.__stockScanProgressStore = sharedStore;

function nowIso(): string {
  return new Date().toISOString();
}

export function setScanProgress(
  userKey: string,
  update: Partial<ScanProgress> & { phase: ScanPhase; message?: string },
): void {
  const current = sharedStore.get(userKey);
  const next: ScanProgress = {
    running: update.running ?? current?.running ?? false,
    phase: update.phase,
    completed: update.completed ?? current?.completed ?? 0,
    total: update.total ?? current?.total ?? 0,
    startedAt: update.startedAt ?? current?.startedAt ?? null,
    updatedAt: nowIso(),
    message: update.message ?? current?.message ?? '',
  };
  sharedStore.set(userKey, next);
}

export function getScanProgress(userKey: string): ScanProgress {
  return (
    sharedStore.get(userKey) || {
      running: false,
      phase: 'idle',
      completed: 0,
      total: 0,
      startedAt: null,
      updatedAt: nowIso(),
      message: 'Idle',
    }
  );
}
