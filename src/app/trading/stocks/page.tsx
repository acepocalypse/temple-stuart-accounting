'use client';

import { useMemo, useState } from 'react';

type Card = {
  symbol: string;
  sector: string | null;
  direction: 'LONG' | 'SHORT' | 'WATCH';
  setupType: string;
  score: number;
  dailyBiasScore: number;
  triggerScore: number;
  plan: {
    entry: number | null;
    stop: number | null;
    target1: number | null;
    target2: number | null;
    shares: number;
    notional: number;
    riskRewardToT1: number | null;
  };
  explanations: string[];
  riskFlags: string[];
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

const fmt = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(2));

export default function StockIntelligencePage() {
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingShortlist, setLoadingShortlist] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [shortlist, setShortlist] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => shortlist?.cards || scan?.cards || [], [scan, shortlist]);
  const watchlist = useMemo(() => shortlist?.watchlist || scan?.watchlist || [], [scan, shortlist]);
  const summary = (shortlist?.summary || scan?.summary || null) as Record<string, number | string> | null;
  const diagnostics = shortlist?.diagnostics || scan?.diagnostics || null;

  async function runDailyScan() {
    setError(null);
    setLoadingScan(true);
    try {
      const res = await fetch('/api/stocks/scan?refresh=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setScan(data);
      setShortlist(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingScan(false);
    }
  }

  async function refreshShortlist() {
    setError(null);
    setLoadingShortlist(true);
    try {
      const res = await fetch('/api/stocks/shortlist?refresh=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setShortlist(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingShortlist(false);
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-4">
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
          <Stat label="Universe" value={Number(summary.finalUniverse || 0)} />
          <Stat label="Scored" value={Number(summary.scoredWithConvergence || 0)} />
          <Stat label="15m Evaluated" value={Number(summary.intradayEvaluated || summary.refreshedSymbols || 0)} />
          <Stat label="Open Positions" value={Number(summary.openPositions || 0)} />
          <Stat label="Slots Available" value={Number(summary.availableSlots || 0)} />
          <Stat label="Selected Cards" value={Number(summary.selectedCards || 0)} />
        </div>
      )}

      <section className="bg-white border border-gray-200">
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
          Actionable Trade Cards ({cards.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#2d1b4e] text-white">
              <tr>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Dir</th>
                <th className="text-left px-3 py-2">Setup</th>
                <th className="text-right px-3 py-2">Comp</th>
                <th className="text-right px-3 py-2">Daily</th>
                <th className="text-right px-3 py-2">15m</th>
                <th className="text-right px-3 py-2">Entry</th>
                <th className="text-right px-3 py-2">Stop</th>
                <th className="text-right px-3 py-2">T1</th>
                <th className="text-right px-3 py-2">Shares</th>
                <th className="text-right px-3 py-2">Notional</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cards.map((card) => (
                <tr key={card.symbol}>
                  <td className="px-3 py-2 font-mono font-semibold">{card.symbol}</td>
                  <td className="px-3 py-2">{card.direction}</td>
                  <td className="px-3 py-2">{card.setupType}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.score)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.dailyBiasScore)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.triggerScore)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan.entry)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan.stop)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan.target1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{card.plan.shares}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(card.plan.notional)}</td>
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

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
            Watchlist ({watchlist.length})
          </div>
          <div className="max-h-96 overflow-auto">
            {watchlist.map((w) => (
              <div key={w.symbol} className="px-4 py-2 border-b border-gray-100 text-xs">
                <div className="flex justify-between">
                  <span className="font-mono font-semibold">{w.symbol}</span>
                  <span className="text-gray-500">{w.direction} / {w.setupType}</span>
                </div>
                <div className="text-gray-600 mt-1">{w.explanations[0]}</div>
              </div>
            ))}
            {watchlist.length === 0 && (
              <div className="px-4 py-6 text-xs text-gray-500">No watchlist items.</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
            Diagnostics
          </div>
          <div className="p-4 text-xs space-y-2">
            <div>Runtime: {diagnostics ? `${diagnostics.runtimeMs} ms` : '-'}</div>
            <div>
              <div className="font-medium text-gray-700 mb-1">Fetch Gaps</div>
              {(diagnostics?.fetchGaps || []).length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-gray-600">
                  {(diagnostics?.fetchGaps || []).map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              ) : <div className="text-gray-500">None</div>}
            </div>
            <div>
              <div className="font-medium text-gray-700 mb-1">Errors</div>
              {(diagnostics?.errors || []).length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-red-700">
                  {(diagnostics?.errors || []).map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              ) : <div className="text-gray-500">None</div>}
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
