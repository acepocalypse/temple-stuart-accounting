export interface FallbackInputs {
  returnedCards: number;
  shortlisted: number;
  poolMin: number;
}

export interface FallbackState {
  active: boolean;
  enteredAt: string | null;
  lastRescanAt: string | null;
}

export function shouldActivateFallback(input: FallbackInputs): boolean {
  return input.returnedCards === 0 && input.shortlisted < input.poolMin;
}

export function applyFallbackTransition(
  state: FallbackState,
  input: FallbackInputs,
  nowIso: string,
): { next: FallbackState; changed: boolean; entered: boolean; exited: boolean } {
  const activeNow = shouldActivateFallback(input);
  if (activeNow === state.active) {
    return { next: state, changed: false, entered: false, exited: false };
  }
  if (activeNow) {
    return {
      next: { ...state, active: true, enteredAt: nowIso },
      changed: true,
      entered: true,
      exited: false,
    };
  }
  return {
    next: { ...state, active: false, enteredAt: null, lastRescanAt: null },
    changed: true,
    entered: false,
    exited: true,
  };
}

export function shouldRunFallbackRescan(
  nowMs: number,
  state: FallbackState,
  intervalMinutes: number,
): boolean {
  if (!state.active) return false;
  if (!state.lastRescanAt) return true;
  const lastMs = Date.parse(state.lastRescanAt);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMinutes * 60_000;
}
