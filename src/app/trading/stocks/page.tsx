'use client';

import { useMemo, useState } from 'react';

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
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => shortlist?.cards || scan?.cards || [], [scan, shortlist]);
  const watchlist = useMemo(() => shortlist?.watchlist || scan?.watchlist || [], [scan, shortlist]);
  const summary = (shortlist?.summary || scan?.summary || null) as Record<string, number | string> | null;
  const diagnostics = shortlist?.diagnostics || scan?.diagnostics || null;

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

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-4 min-h-screen flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Manual Stock Intelligence</h1>
          <p className="text-sm text-gray-600">
            Daily bias + 15m trigger, whole-share sizing, no broker execution.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runDailyScan}
            disabled={loadingScan}
            className="px-3 py-2 text-sm bg-[#2d1b4e] text-white disabled:opacity-50 hover:bg-[#3d2b5e]"
          >
            {loadingScan ? 'Running Daily Scan...' : 'Run Daily Scan'}
          </button>
          <button
            onClick={refreshShortlist}
            disabled={loadingShortlist}
            className="px-3 py-2 text-sm bg-gray-900 text-white disabled:opacity-50 hover:bg-black"
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
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-2">
          <Stat label="Scanner Symbols" value={Number(summary.scannerSymbols || 0)} />
          <Stat label="Filtered" value={Number(summary.filteredByPriceLiquidity || 0)} />
          <Stat label="Scored" value={Number(summary.scoredUniverse || 0)} />
          <Stat label="Refreshed" value={Number(summary.refreshedSymbols || 0)} />
          <Stat label="Shortlisted" value={Number(summary.shortlisted || 0)} />
          <Stat label="Returned" value={Number(summary.returnedCards || 0)} />
          <Stat label="No Setups" value={summary.noSetups ? 1 : 0} />
        </div>
      )}

      {loadingScan && scanProgress && (
        <div className="border border-gray-200 bg-white px-3 py-2 text-xs">
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

      <section className="bg-white border border-gray-200">
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
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
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-sans font-medium text-amber-800">
                        Manual
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
      </section>

      <section className="grid lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="bg-white border border-gray-200 flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
            Watchlist ({watchlist.length})
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {watchlist.map((w) => (
              <div key={w.ticker} className="px-4 py-2 border-b border-gray-100 text-xs">
                <div className="flex justify-between">
                  <a
                    href={stockAnalysisUrl(w.ticker)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-semibold text-gray-900 underline-offset-2 hover:underline"
                  >
                    {w.ticker}
                  </a>
                  <span className="text-gray-700">{w.blockedReason || 'Watch'}</span>
                </div>
                <div className="text-gray-700 mt-1">{w.plainEnglish || w.why[0]}</div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => promoteTicker(w.ticker)}
                    disabled={!w.plan || promotingTicker === w.ticker}
                    className="px-2 py-1 text-[11px] border border-gray-300 text-gray-800 disabled:opacity-50 hover:bg-gray-50"
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

        <div className="bg-white border border-gray-200 flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
            Diagnostics
          </div>
          <div className="p-4 text-xs space-y-2 flex-1 min-h-0 overflow-auto">
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
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-mono text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
