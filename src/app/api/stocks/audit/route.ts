import { NextResponse } from 'next/server';
import { getAuditRecords } from '@/lib/stock-intelligence/storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 200);
  return NextResponse.json({
    records: getAuditRecords(Number.isFinite(limit) ? Math.max(1, Math.min(2000, limit)) : 200),
  });
}

