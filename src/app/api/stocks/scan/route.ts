import { NextResponse } from 'next/server';
import { getDailyStockScan, getDefaultStockConfig, resolveUserIdFromCookie } from '@/lib/stocks/engine';

export const maxDuration = 300;

function parseNumberParam(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromCookie();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    const defaults = getDefaultStockConfig();
    const configOverride = {
      accountSize: parseNumberParam(searchParams.get('accountSize')) ?? defaults.accountSize,
      riskPerTradePct: parseNumberParam(searchParams.get('riskPct')) ?? defaults.riskPerTradePct,
      maxCapitalPerPositionPct: parseNumberParam(searchParams.get('maxPositionPct')) ?? defaults.maxCapitalPerPositionPct,
      maxOpenPositions: parseNumberParam(searchParams.get('maxOpen')) ?? defaults.maxOpenPositions,
      maxPerSector: parseNumberParam(searchParams.get('maxPerSector')) ?? defaults.maxPerSector,
    };

    const result = await getDailyStockScan(request, userId, refresh, configOverride);
    return NextResponse.json(result, {
      headers: {
        'X-Generated-At': result.generatedAt,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Stocks Scan] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
