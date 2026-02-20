import { NextResponse } from 'next/server';
import { nowIso } from '@/lib/stock-intelligence/dates';
import { listApprovals, logApproval } from '@/lib/stock-intelligence/storage';
import type { TradePlan } from '@/lib/stock-intelligence/types';

function isTradePlan(value: unknown): value is TradePlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.triggerPrice === 'number' &&
    typeof v.stopPrice === 'number' &&
    typeof v.oneR === 'number' &&
    typeof v.twoR === 'number' &&
    typeof v.riskPerShare === 'number'
  );
}

export async function GET() {
  return NextResponse.json({
    approvals: listApprovals(),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ticker = String(body.ticker || '').toUpperCase();
    const plan = body.plan;
    const note = body.note == null ? null : String(body.note);
    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }
    if (!isTradePlan(plan)) {
      return NextResponse.json({ error: 'valid plan is required' }, { status: 400 });
    }
    const approval = {
      id: `${ticker}-${Date.now()}`,
      ticker,
      approvedAt: nowIso(),
      plan,
      note,
      status: 'OPEN' as const,
    };
    logApproval(approval);
    return NextResponse.json({ ok: true, approval });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
