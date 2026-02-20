import { NextResponse } from 'next/server';
import { getMarketTimeParts, isWithinMarketWindow } from '@/lib/stock-intelligence/scheduler/market-window';
import { loadSchedulerState } from '@/lib/stock-intelligence/notify/state';
import { getAlpacaPaperStatus } from '@/lib/stock-intelligence/execution/alpaca';

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v.toLowerCase() === 'true';
}

export async function GET() {
  try {
    const cfg = {
      enabled: parseBool(process.env.SCHEDULER_ENABLED, false),
      timeZone: process.env.SCHEDULER_TIMEZONE || 'America/New_York',
      windowStartEt: process.env.SCHEDULER_WINDOW_START_ET || '04:00',
      windowEndEt: process.env.SCHEDULER_WINDOW_END_ET || '16:00',
      dailyScanTimeEt: process.env.SCHEDULER_DAILY_SCAN_TIME_ET || '09:20',
      refreshMinutes: Number(process.env.SCHEDULER_REFRESH_MINUTES || 15),
      fallbackRescanMinutes: Number(process.env.SCHEDULER_FALLBACK_RESCAN_MINUTES || 60),
      fallbackPoolMin: Number(process.env.SCHEDULER_FALLBACK_POOL_MIN || 5),
      statePath: process.env.SCHEDULER_STATE_PATH || '/data/scheduler-state.json',
    };
    const now = new Date();
    const marketParts = getMarketTimeParts(now, cfg.timeZone);
    const state = await loadSchedulerState(cfg.statePath);
    const alpaca = await getAlpacaPaperStatus();

    return NextResponse.json({
      nowIso: now.toISOString(),
      scheduler: cfg,
      market: {
        inWindow: isWithinMarketWindow(now, cfg),
        ...marketParts,
      },
      state,
      alpaca,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
