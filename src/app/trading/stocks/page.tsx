'use client';

import { useEffect, useMemo, useState } from 'react';

type Card = {
  ticker: string;
  sector: string | null;
  liquidityRank: number;
  status: 'ACTIONABLE' | 'WATCH_ONLY';
  manuallyPromoted?: boolean;
  blocked: boolean;
  blockedReason: string | null;
  overallScore: number;
  confidence: {
    score: number;
    label: string;
  };
  convergence: {
    met: boolean;
    strength: string;
  };
  plainEnglish: string | null;
  plan: {
    triggerDescription: string;
    triggerPrice: number;
    stopDescription: string;
    stopPrice: number;
    status: 'ACTIONABLE' | 'WATCH_ONLY';
    volumeConfirmed: boolean;
    atr14: number | null;
    distanceTo20dmaPct: number | null;
    daily20dma: number | null;
    recent15mSwingHigh: number | null;
    recent15mSwingLow: number | null;
    entryTo20dmaDistancePct: number | null;
    riskPerShare: number;
    oneR: number | null;
    twoR: number | null;
  } | null;
  why: string[];
  riskWarnings: string[];
};

type ScanResponse = {
  generatedAt: string;
  summary: Record<string, number | string>;
  cards: Card[];
  watchlist: Card[];
  diagnostics: {
    errors: string[];
    fetchGaps: string[];
    runtimeMs?: number;
  };
};

type ProgressResponse = {
  running: boolean;
  phase: string;
  completed: number;
  total: number;
  startedAt: string | null;
  updatedAt: string;
  message: string;
  percent: number;
};

type AutomationStatus = {
  nowIso: string;
  scheduler: {
    enabled: boolean;
    timeZone: string;
    windowStartEt: string;
    windowEndEt: string;
    dailyScanTimeEt: string;
    refreshMinutes: number;
    fallbackRescanMinutes: number;
    fallbackPoolMin: number;
    statePath: string;
  };
  market: {
    inWindow: boolean;
    dateKey: string;
    hour: number;
    minute: number;
  };
  state: {
    fallbackActive: boolean;
    lastDailyRunMarketDate: string | null;
    lastRefreshSlotKey: string | null;
    lastFallbackRescanAt: string | null;
    lastActionableSnapshot: Array<{ ticker: string; score: number; triggerPrice: number | null }> | null;
  };
  alpaca: {
    enabled: boolean;
    connected: boolean;
    error: string | null;
    executeOnModes: string[];
    account: {
      status: string | null;
      cash: string | null;
      buyingPower: string | null;
      portfolioValue: string | null;
      currency: string | null;
    } | null;
    positionsCount: number;
    openOrdersCount: number;
    positionSymbols: string[];
    openOrderSymbols: string[];
    recentOrderSymbols: string[];
    recentOrders: Array<{
      id: string;
      symbol: string;
      status: string;
      side: string;
      qty: string;
      createdAt: string | null;
    }>;
  };
};

const fmt = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(2));
const stockAnalysisUrl = (ticker: string) =>
  `https://stockanalysis.com/stocks/${encodeURIComponent(ticker)}`;

export default function StockIntelligencePage() {
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingShortlist, setLoadingShortlist] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [shortlist, setShortlist] = useState<ScanResponse | null>(null);
  const [scanProgress, setScanProgress] = useState<ProgressResponse | null>(null);
  const [promotingTicker, setPromotingTicker] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationAction, setAutomationAction] = useState<string | null>(null);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => shortlist?.cards || scan?.cards || [], [scan, shortlist]);
  const watchlist = useMemo(() => shortlist?.watchlist || scan?.watchlist || [], [scan, shortlist]);
  const summary = (shortlist?.summary || scan?.summary || null) as Record<string, number | string> | null;
  const diagnostics = shortlist?.diagnostics || scan?.diagnostics || null;
  const positionSymbols = useMemo(
    () => new Set((automation?.alpaca.positionSymbols || []).map((s) => s.toUpperCase())),
    [automation?.alpaca.positionSymbols],
  );
  const openOrderSymbols = useMemo(
    () => new Set((automation?.alpaca.openOrderSymbols || []).map((s) => s.toUpperCase())),
    [automation?.alpaca.openOrderSymbols],
  );
  const recentOrderSymbols = useMemo(
    () => new Set((automation?.alpaca.recentOrderSymbols || []).map((s) => s.toUpperCase())),
    [automation?.alpaca.recentOrderSymbols],
  );

  useEffect(() => {
    void loadAutomationStatus();
  }, []);

  async function loadAutomationStatus() {
    setAutomationLoading(true);
    try {
      const res = await fetch('/api/stocks/automation/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAutomation(data as AutomationStatus);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutomationLoading(false);
    }
  }

  async function runDailyScan() {
    setError(null);
    setLoadingScan(true);
    setScanProgress({
      running: true,
      phase: 'loading_daily_candles',
      completed: 0,
      total: 1,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: 'Starting daily scan',
      percent: 1,
    });
    let intervalId: ReturnType<typeof setInterval> | null = null;
    try {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch('/api/stocks/scan/status');
          if (!res.ok) return;
          const data = (await res.json()) as ProgressResponse;
          setScanProgress((prev) => {
            if (!prev) return data;
            // Fallback when backend status endpoint is still cold/idle.
            if (
              data.phase === 'idle' &&
              prev.running &&
              prev.phase !== 'complete' &&
              prev.phase !== 'error'
            ) {
              const nextPct = Math.min(95, Math.max(prev.percent + 2, 5));
              return {
                ...prev,
                percent: nextPct,
                updatedAt: new Date().toISOString(),
                message: 'Scan is running; awaiting first server progress update...',
              };
            }
            return data;
          });
        } catch {
          // silent
        }
      }, 1200);

      const res = await fetch('/api/stocks/scan?refresh=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setScan(data);
      setShortlist(null);
      void loadAutomationStatus();
      setScanProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              phase: 'complete',
              percent: 100,
              message: 'Daily scan complete',
            }
          : null,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (intervalId) clearInterval(intervalId);
      setLoadingScan(false);
    }
  }

  async function refreshShortlist() {
    setError(null);
    setLoadingShortlist(true);
    try {
      const res = await fetch('/api/stocks/refresh?refresh=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setShortlist(data);
      void loadAutomationStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingShortlist(false);
    }
  }

  async function promoteTicker(ticker: string) {
    setError(null);
    setPromotingTicker(ticker);
    const snapshot = shortlist || scan;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/stocks/watchlist/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, snapshot }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const errorMessage =
        typeof data.error === 'string' && data.error.trim() ? data.error : `HTTP ${res.status}`;
      if (!res.ok) throw new Error(errorMessage);
      const result = data?.result as ScanResponse | undefined;
      if (!result) throw new Error('Promotion response missing result payload.');
      setShortlist(result);
      void loadAutomationStatus();
    } catch (e: unknown) {
      const message =
        e instanceof Error && e.name === 'AbortError'
          ? 'Move to Actionable timed out. Please retry.'
          : e instanceof Error
            ? e.message
            : String(e);
      setError(message);
    } finally {
      clearTimeout(timeout);
      setPromotingTicker(null);
    }
  }

  async function runAutomationAction(action: string) {
    setAutomationAction(action);
    setAutomationMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/stocks/automation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      if (!res.ok) throw new Error(message);

      const result = data.result as ScanResponse | undefined;
      if (action === 'run_daily_now' && result) {
        setScan(result);
        setShortlist(null);
      }
      if (action === 'run_refresh_now' && result) {
        setShortlist(result);
      }

      if (action === 'test_telegram') setAutomationMessage('Telegram test sent.');
      if (action === 'test_alpaca') setAutomationMessage('Alpaca connectivity checked.');
      if (action === 'run_scheduler_tick') setAutomationMessage('Scheduler tick executed once.');
      if (action === 'run_daily_now') setAutomationMessage('Daily scan executed.');
      if (action === 'run_refresh_now') setAutomationMessage('Refresh executed.');
      await loadAutomationStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutomationAction(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 bg-gray-100 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Manual Stock Intelligence</h1>
          <p className="text-sm text-gray-600">
            Daily bias + 15m trigger, whole-share sizing, no broker execution.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runDailyScan}
            disabled={loadingScan}
            className="rounded-md bg-[#2d1b4e] px-3 py-2 text-sm text-white hover:bg-[#3d2b5e] disabled:opacity-50"
          >
            {loadingScan ? 'Running Daily Scan...' : 'Run Daily Scan'}
          </button>
          <button
            onClick={refreshShortlist}
            disabled={loadingShortlist}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black disabled:opacity-50"
          >
            {loadingShortlist ? 'Refreshing 15m...' : 'Refresh 15m Shortlist'}
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Scanner Symbols" value={Number(summary.scannerSymbols || 0)} />
          <Stat label="Filtered" value={Number(summary.filteredByPriceLiquidity || 0)} />
          <Stat label="Scored" value={Number(summary.scoredUniverse || 0)} />
          <Stat label="Refreshed" value={Number(summary.refreshedSymbols || 0)} />
          <Stat label="Shortlisted" value={Number(summary.shortlisted || 0)} />
          <Stat label="Returned" value={Number(summary.returnedCards || 0)} />
          <Stat label="No Setups" value={summary.noSetups ? 1 : 0} />
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-800">
          <span>Automation</span>
          <button
            type="button"
            onClick={loadAutomationStatus}
            disabled={automationLoading}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {automationLoading ? 'Refreshing...' : 'Refresh Status'}
          </button>
        </div>
        <div className="space-y-4 p-4 text-xs text-gray-800">
          <div className="flex flex-wrap gap-2">
            <StatusPill label="Scheduler" on={Boolean(automation?.scheduler.enabled)} />
            <StatusPill label="Market Window" on={Boolean(automation?.market.inWindow)} />
            <StatusPill label="Fallback" on={Boolean(automation?.state.fallbackActive)} offText="Idle" />
            <StatusPill label="Alpaca" on={Boolean(automation?.alpaca.connected)} offText="Offline" />
            <StatusPill
              label="Auto-Trade"
              on={Boolean(automation?.alpaca.enabled && automation?.alpaca.connected)}
              onText="Armed"
              offText="Disarmed"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-3 rounded-md border border-gray-300 bg-gray-50 p-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Positions" value={automation?.alpaca.positionsCount || 0} />
                <Stat label="Open Orders" value={automation?.alpaca.openOrdersCount || 0} />
                <Stat label="Actionable Snap" value={automation?.state.lastActionableSnapshot?.length || 0} />
                <Stat label="Refresh Mins" value={Number(automation?.scheduler.refreshMinutes || 0)} />
              </div>
              <div className="grid gap-x-4 gap-y-1 text-[11px] text-gray-700 md:grid-cols-2">
                <div>
                  Market Time:{' '}
                  {automation
                    ? `${automation.market.dateKey} ${String(automation.market.hour).padStart(2, '0')}:${String(automation.market.minute).padStart(2, '0')} ET`
                    : '-'}
                </div>
                <div>
                  Window:{' '}
                  {automation
                    ? `${automation.scheduler.windowStartEt} - ${automation.scheduler.windowEndEt} ET`
                    : '-'}
                </div>
                <div>Daily Scan Time: {automation?.scheduler.dailyScanTimeEt || '-'}</div>
                <div>Alpaca Mode: {automation?.alpaca.executeOnModes?.join(', ') || '-'}</div>
                <div className="md:col-span-2">
                  Account:{' '}
                  {automation?.alpaca.account
                    ? `${automation.alpaca.account.status} | Cash ${automation.alpaca.account.cash} | Buying Power ${automation.alpaca.account.buyingPower}`
                    : automation?.alpaca.error || '-'}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-gray-300 bg-white p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                Controls
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runAutomationAction('run_daily_now')}
                  disabled={automationAction !== null}
                  className="rounded-md border border-[#2d1b4e] bg-[#2d1b4e] px-2 py-1.5 text-xs text-white hover:bg-[#3d2b5e] disabled:opacity-50"
                >
                  {automationAction === 'run_daily_now' ? 'Running...' : 'Run Daily'}
                </button>
                <button
                  type="button"
                  onClick={() => runAutomationAction('run_refresh_now')}
                  disabled={automationAction !== null}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {automationAction === 'run_refresh_now' ? 'Running...' : 'Run Refresh'}
                </button>
                <button
                  type="button"
                  onClick={() => runAutomationAction('run_scheduler_tick')}
                  disabled={automationAction !== null}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {automationAction === 'run_scheduler_tick' ? 'Running...' : 'Run Tick'}
                </button>
                <button
                  type="button"
                  onClick={() => runAutomationAction('test_alpaca')}
                  disabled={automationAction !== null}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {automationAction === 'test_alpaca' ? 'Running...' : 'Test Alpaca'}
                </button>
                <button
                  type="button"
                  onClick={() => runAutomationAction('test_telegram')}
                  disabled={automationAction !== null}
                  className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {automationAction === 'test_telegram' ? 'Running...' : 'Test Telegram'}
                </button>
              </div>
              {automationMessage ? (
                <div className="mt-2 rounded border border-[#d5c6ea] bg-[#efe8fa] px-2 py-1 text-xs text-[#2d1b4e]">
                  {automationMessage}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-600">
              Recent Alpaca Orders
            </div>
            {(automation?.alpaca.recentOrders || []).length > 0 ? (
              <div className="max-h-48 overflow-auto rounded-md border border-gray-300">
                <table className="w-full text-xs text-gray-900">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">Symbol</th>
                      <th className="px-2 py-1 text-left">Side</th>
                      <th className="px-2 py-1 text-left">Qty</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(automation?.alpaca.recentOrders || []).map((o) => (
                      <tr key={o.id}>
                        <td className="px-2 py-1 font-mono">{o.symbol}</td>
                        <td className="px-2 py-1">{o.side}</td>
                        <td className="px-2 py-1">{o.qty}</td>
                        <td className="px-2 py-1">{o.status}</td>
                        <td className="px-2 py-1">{o.createdAt || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-gray-600">No recent orders.</div>
            )}
          </div>
        </div>
      </section>

      {loadingScan && scanProgress && (
        <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-800">
              Daily scan: {scanProgress.phase.replaceAll('_', ' ')}
            </span>
            <span className="font-mono text-gray-800">
              {scanProgress.completed}/{scanProgress.total} ({scanProgress.percent}%)
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-gray-900 transition-all duration-500 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, scanProgress.percent))}%` }}
            />
          </div>
          <div className="mt-1 text-gray-700">{scanProgress.message}</div>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(320px,1fr)]">
        <div className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          <div className="border-b border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-800">
            Actionable Trade Cards ({cards.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-900">
            <thead className="bg-[#2d1b4e] text-white">
              <tr>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Liq Rank</th>
                <th className="text-left px-3 py-2">Conf</th>
                <th className="text-right px-3 py-2">Score</th>
                <th className="text-right px-3 py-2">Conv</th>
                <th className="text-right px-3 py-2">Trigger</th>
                <th className="text-right px-3 py-2">Stop</th>
                <th className="text-right px-3 py-2">Risk/Share</th>
                <th className="text-right px-3 py-2">1R</th>
                <th className="text-right px-3 py-2">2R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {cards.map((card) => (
                <tr key={card.ticker}>
                  <td className="px-3 py-2 font-mono font-semibold">
                    <a
                      href={stockAnalysisUrl(card.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-900 underline-offset-2 hover:underline"
                    >
                      {card.ticker}
                    </a>
                    {card.manuallyPromoted ? (
                      <span className="ml-2 rounded border border-[#d5c6ea] bg-[#efe8fa] px-1.5 py-0.5 text-[10px] font-sans font-medium text-[#2d1b4e]">
                        Manual
                      </span>
                    ) : null}
                    {positionSymbols.has(card.ticker.toUpperCase()) ? (
                      <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                        Position
                      </span>
                    ) : null}
                    {openOrderSymbols.has(card.ticker.toUpperCase()) ? (
                      <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                        Open Order
                      </span>
                    ) : null}
                    {recentOrderSymbols.has(card.ticker.toUpperCase()) &&
                    !openOrderSymbols.has(card.ticker.toUpperCase()) &&
                    !positionSymbols.has(card.ticker.toUpperCase()) ? (
                      <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                        Recent Order
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{card.status}</td>
                  <td className="px-3 py-2 text-right font-mono">{card.liquidityRank}</td>
                  <td className="px-3 py-2">{card.confidence.label}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.overallScore)}</td>
                  <td className="px-3 py-2 text-right font-mono">{card.convergence.strength}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan?.triggerPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan?.stopPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan?.riskPerShare)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan?.oneR)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan?.twoR)}</td>
                </tr>
              ))}
              {cards.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={11}>
                    Run a daily scan to generate trade cards.
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          <div className="border-b border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-800">
            Watchlist ({watchlist.length})
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
          {watchlist.map((w) => (
            <div key={w.ticker} className="px-4 py-2 border-b border-gray-100 text-xs">
              <div className="flex justify-between">
                <div>
                  <a
                    href={stockAnalysisUrl(w.ticker)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-semibold text-gray-900 underline-offset-2 hover:underline"
                  >
                    {w.ticker}
                  </a>
                  {positionSymbols.has(w.ticker.toUpperCase()) ? (
                    <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                      Position
                    </span>
                  ) : null}
                  {openOrderSymbols.has(w.ticker.toUpperCase()) ? (
                    <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                      Open Order
                    </span>
                  ) : null}
                  {recentOrderSymbols.has(w.ticker.toUpperCase()) &&
                  !openOrderSymbols.has(w.ticker.toUpperCase()) &&
                  !positionSymbols.has(w.ticker.toUpperCase()) ? (
                    <span className="ml-2 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-700">
                      Recent Order
                    </span>
                  ) : null}
                </div>
                <span className="text-gray-700">{w.blockedReason || 'Watch'}</span>
              </div>
              <div className="text-gray-700 mt-1">{w.plainEnglish || w.why[0]}</div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => promoteTicker(w.ticker)}
                  disabled={!w.plan || promotingTicker === w.ticker}
                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {promotingTicker === w.ticker ? 'Moving...' : 'Move to Actionable'}
                </button>
              </div>
            </div>
          ))}
          {watchlist.length === 0 && (
            <div className="px-4 py-6 text-xs text-gray-500">No watchlist items.</div>
          )}
        </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-800">
          <span>Diagnostics</span>
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
          >
            {showDiagnostics ? 'Hide' : 'Show'}
          </button>
        </div>
        {showDiagnostics ? (
          <div className="p-3 text-xs space-y-2 max-h-52 overflow-auto">
            <div className="text-gray-900 font-medium">Runtime: {diagnostics ? `${diagnostics.runtimeMs} ms` : '-'}</div>
            <div>
              <div className="font-medium text-gray-800 mb-1">Fetch Gaps</div>
              {(diagnostics?.fetchGaps || []).length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-gray-700">
                  {(diagnostics?.fetchGaps || []).map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              ) : <div className="text-gray-700">None</div>}
            </div>
            <div>
              <div className="font-medium text-gray-800 mb-1">Errors</div>
              {(diagnostics?.errors || []).length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-red-700">
                  {(diagnostics?.errors || []).map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              ) : <div className="text-gray-700">None</div>}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-mono text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function StatusPill({
  label,
  on,
  onText = 'On',
  offText = 'Off',
}: {
  label: string;
  on: boolean;
  onText?: string;
  offText?: string;
}) {
  return (
    <div
      className={`rounded-full border px-2.5 py-1 text-[11px] ${
        on
          ? 'border-[#d5c6ea] bg-[#efe8fa] text-[#2d1b4e]'
          : 'border-gray-200 bg-gray-50 text-gray-600'
      }`}
    >
      <span className="font-medium">{label}:</span> {on ? onText : offText}
    </div>
  );
}
