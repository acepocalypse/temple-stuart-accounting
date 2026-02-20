import { NextResponse } from 'next/server';
import { getDailyScanProgress } from '@/lib/stock-intelligence/engine';

export async function GET() {
  const progress = getDailyScanProgress('manual-stock-user');
  const pct =
    progress.total > 0
      ? Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
      : 0;
  return NextResponse.json({
    ...progress,
    percent: pct,
  });
}

