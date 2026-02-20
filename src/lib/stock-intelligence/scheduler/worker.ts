import { runDailyScan, runIntradayRefresh } from '../engine';
import type { DailyScanResult, RefreshResult, TradeCard } from '../types';
import { diffActionable, snapshotActionable } from '../notify/diff';
import { executeAlpacaPaperTrades } from '../execution/alpaca';
import {
  DEFAULT_SCHEDULER_STATE,
  loadSchedulerState,
  markNotification,
  saveSchedulerState,
  shouldThrottleNotification,
  type SchedulerState,
} from '../notify/state';
import { sendTelegramMessage } from '../notify/telegram';
import {
  getMarketDateKey,
  getMarketTimeParts,
  getRefreshSlotKey,
  isWithinMarketWindow,
  shouldRunDailyScanAt,
  shouldRunRefreshAt,
} from './market-window';
import { applyFallbackTransition, shouldRunFallbackRescan } from './fallback';

type ScanResult = DailyScanResult | RefreshResult;

export interface SchedulerConfig {
  enabled: boolean;
  userKey: string;
  timeZone: string;
  windowStartEt: string;
  windowEndEt: string;
  dailyScanTimeEt: string;
  refreshMinutes: number;
  fallbackRescanMinutes: number;
  fallbackPoolMin: number;
  statePath: string;
  appUrl: string | null;
}

type WorkerDeps = {
  now: () => Date;
  runDaily: (userKey: string, refresh: boolean, overrides?: Record<string, unknown>) => Promise<DailyScanResult>;
  runRefresh: (userKey: string, refresh: boolean, overrides?: Record<string, unknown>) => Promise<RefreshResult>;
  notify: (text: string) => Promise<void>;
  executeTrades: (cards: TradeCard[], mode: 'daily' | 'refresh' | 'fallback_rescan') => Promise<{
    placed: Array<{ ticker: string; orderId: string }>;
    skipped: Array<{ ticker: string; reason: string }>;
    errors: Array<{ ticker: string; error: string }>;
  }>;
  loadState: (path: string) => Promise<SchedulerState>;
  saveState: (path: string, state: SchedulerState) => Promise<void>;
  log: (msg: string, details?: Record<string, unknown>) => void;
};

const defaultDeps: WorkerDeps = {
  now: () => new Date(),
  runDaily: (userKey, refresh, overrides) => runDailyScan(userKey, refresh, overrides),
  runRefresh: (userKey, refresh, overrides) => runIntradayRefresh(userKey, refresh, overrides),
  notify: (text) => sendTelegramMessage(text),
  executeTrades: (cards, mode) => executeAlpacaPaperTrades({ cards, mode }),
  loadState: (path) => loadSchedulerState(path),
  saveState: (path, state) => saveSchedulerState(path, state),
  log: (msg, details) => console.log(`[scheduler] ${msg}`, details || {}),
};

function getConfig(env: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  return {
    enabled: (env.SCHEDULER_ENABLED || 'false').toLowerCase() === 'true',
    userKey: env.SCHEDULER_USER_KEY || 'manual-stock-user',
    timeZone: env.SCHEDULER_TIMEZONE || 'America/New_York',
    windowStartEt: env.SCHEDULER_WINDOW_START_ET || '04:00',
    windowEndEt: env.SCHEDULER_WINDOW_END_ET || '16:00',
    dailyScanTimeEt: env.SCHEDULER_DAILY_SCAN_TIME_ET || '09:20',
    refreshMinutes: Number(env.SCHEDULER_REFRESH_MINUTES || 15),
    fallbackRescanMinutes: Number(env.SCHEDULER_FALLBACK_RESCAN_MINUTES || 60),
    fallbackPoolMin: Number(env.SCHEDULER_FALLBACK_POOL_MIN || 5),
    statePath: env.SCHEDULER_STATE_PATH || '/data/scheduler-state.json',
    appUrl: env.NEXT_PUBLIC_APP_URL || null,
  };
}

function formatNotificationHeader(kind: string, parts: { dateKey: string; hour: number; minute: number }): string {
  return `${kind} ${parts.dateKey} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} ET`;
}

function buildActionableMessage(
  kind: string,
  result: ScanResult,
  config: SchedulerConfig,
  parts: { dateKey: string; hour: number; minute: number },
  stateChange?: string,
): string {
  const cards = result.cards || [];
  const actionable = cards.map((c) => c.ticker).join(', ') || 'None';
  const summary = result.summary;
  const shortlisted = 'shortlisted' in summary ? summary.shortlisted : null;
  const lines = [
    formatNotificationHeader(kind, parts),
    `Actionable: ${cards.length}`,
    shortlisted === null ? null : `Shortlisted: ${shortlisted}`,
    `Tickers: ${actionable}`,
    stateChange || null,
    config.appUrl ? `Open: ${config.appUrl}/trading/stocks` : null,
  ].filter((x): x is string => Boolean(x));
  return lines.join('\n');
}

export class SchedulerWorker {
  private running = false;
  private state: SchedulerState = { ...DEFAULT_SCHEDULER_STATE };
  private lock = false;

  constructor(
    private readonly config: SchedulerConfig = getConfig(),
    private readonly deps: WorkerDeps = defaultDeps,
  ) {}

  async init(): Promise<void> {
    this.state = await this.deps.loadState(this.config.statePath);
    this.deps.log('initialized', { statePath: this.config.statePath, enabled: this.config.enabled });
  }

  async tick(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.lock) return;
    this.lock = true;
    try {
      const now = this.deps.now();
      const parts = getMarketTimeParts(now, this.config.timeZone);
      const inWindow = isWithinMarketWindow(now, this.config);

      if (shouldRunDailyScanAt(now, this.config, this.state.lastDailyRunMarketDate)) {
        await this.runDailyAndNotify(parts, 'daily', undefined);
        this.state.lastDailyRunMarketDate = getMarketDateKey(now, this.config.timeZone);
      }

      if (inWindow && this.state.fallbackActive && shouldRunFallbackRescan(now.getTime(), {
        active: this.state.fallbackActive,
        enteredAt: this.state.fallbackEnteredAt,
        lastRescanAt: this.state.lastFallbackRescanAt,
      }, this.config.fallbackRescanMinutes)) {
        await this.runDailyAndNotify(parts, 'fallback_rescan', {
          universeTargetSize: 300,
        });
        this.state.lastFallbackRescanAt = now.toISOString();
      }

      if (shouldRunRefreshAt(now, this.config, this.state.lastRefreshSlotKey)) {
        const refreshed = await this.deps.runRefresh(this.config.userKey, true);
        this.state.lastRefreshSlotKey = getRefreshSlotKey(now, this.config);
        await this.processResult(refreshed, parts, 'refresh');
      }

      await this.deps.saveState(this.config.statePath, this.state);
    } catch (error: unknown) {
      const nowIso = this.deps.now().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log('tick_error', { message });
      const key = `error:${message.slice(0, 120)}`;
      if (!shouldThrottleNotification(this.state, key, nowIso)) {
        try {
          await this.deps.notify(`Scheduler error:\n${message}`);
          this.state = markNotification(this.state, key, nowIso);
        } catch {
          // noop
        }
      }
    } finally {
      this.lock = false;
    }
  }

  async runForever(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.init();
    while (this.running) {
      await this.tick();
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }

  stop(): void {
    this.running = false;
  }

  private async runDailyAndNotify(
    parts: { dateKey: string; hour: number; minute: number },
    mode: 'daily' | 'fallback_rescan',
    overrides?: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.deps.runDaily(this.config.userKey, true, overrides);
    await this.processResult(result, parts, mode);
  }

  private async processResult(
    result: ScanResult,
    parts: { dateKey: string; hour: number; minute: number },
    mode: 'daily' | 'refresh' | 'fallback_rescan',
  ): Promise<void> {
    const currentSnapshot = snapshotActionable(result.cards || []);
    const delta = diffActionable(this.state.lastActionableSnapshot, currentSnapshot);
    const summary = result.summary;
    const returnedCards = Number(summary.returnedCards || 0);
    const shortlisted = 'shortlisted' in summary ? Number(summary.shortlisted || 0) : 0;
    const nowIso = this.deps.now().toISOString();

    const transition = applyFallbackTransition(
      {
        active: this.state.fallbackActive,
        enteredAt: this.state.fallbackEnteredAt,
        lastRescanAt: this.state.lastFallbackRescanAt,
      },
      {
        returnedCards,
        shortlisted,
        poolMin: this.config.fallbackPoolMin,
      },
      nowIso,
    );
    this.state.fallbackActive = transition.next.active;
    this.state.fallbackEnteredAt = transition.next.enteredAt;
    this.state.lastFallbackRescanAt = transition.next.lastRescanAt;

    const shouldNotify = delta.hasChanges || transition.changed;
    if (shouldNotify) {
      const stateLine = transition.entered
        ? 'Fallback mode entered: no setups and thin pool.'
        : transition.exited
          ? 'Fallback mode exited: setup pool recovered.'
          : null;
      const message = buildActionableMessage(mode, result, this.config, parts, stateLine || undefined);
      await this.deps.notify(message);
    }

    const tradeReport = await this.deps.executeTrades(result.cards || [], mode);
    if (tradeReport.placed.length > 0) {
      const tradeMessage = [
        `${mode.toUpperCase()} paper orders placed`,
        ...tradeReport.placed.map((p) => `- ${p.ticker}${p.orderId ? ` (${p.orderId})` : ''}`),
        this.config.appUrl ? `Open: ${this.config.appUrl}/trading/stocks` : null,
      ]
        .filter((x): x is string => Boolean(x))
        .join('\n');
      await this.deps.notify(tradeMessage);
    }
    if (tradeReport.errors.length > 0) {
      this.deps.log('alpaca_errors', {
        count: tradeReport.errors.length,
        sample: tradeReport.errors.slice(0, 3),
      });
    }
    this.state.lastActionableSnapshot = currentSnapshot;
  }
}

export function createSchedulerWorker(env: NodeJS.ProcessEnv = process.env): SchedulerWorker {
  return new SchedulerWorker(getConfig(env));
}
