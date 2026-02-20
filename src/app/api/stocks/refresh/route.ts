import { NextResponse } from 'next/server';
import { getDefaultConfig, runIntradayRefresh } from '@/lib/stock-intelligence/engine';

export const maxDuration = 300;

function parseNumberParam(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';
    const defaults = getDefaultConfig();
    const expand = searchParams.get('expand');
    const expansionBuffer = parseNumberParam(searchParams.get('expandBuffer'));
    const universeSize = parseNumberParam(searchParams.get('universeSize'));
    const configOverride = {
      minDollarVolume20d:
        parseNumberParam(searchParams.get('minDollarVolume')) ?? defaults.minDollarVolume20d,
      pillarCutoff: parseNumberParam(searchParams.get('pillarCutoff')) ?? defaults.pillarCutoff,
      expansionEnabled: expand == null ? defaults.expansionEnabled : expand === 'true',
      expansionBufferPoints: expansionBuffer ?? defaults.expansionBufferPoints,
      universeTargetSize: universeSize ?? defaults.universeTargetSize,
    };

    const result = await runIntradayRefresh('manual-stock-user', refresh, configOverride);
    return NextResponse.json(result, {
      headers: {
        'X-Generated-At': result.generatedAt,
        'X-Source-Daily-Scan': result.summary.sourceDailyScanAt,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
