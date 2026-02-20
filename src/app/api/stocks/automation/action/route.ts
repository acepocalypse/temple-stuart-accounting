import { NextResponse } from 'next/server';
import { runDailyScan, runIntradayRefresh } from '@/lib/stock-intelligence/engine';
import { sendTelegramMessage } from '@/lib/stock-intelligence/notify/telegram';
import { getAlpacaPaperStatus } from '@/lib/stock-intelligence/execution/alpaca';
import { createSchedulerWorker } from '@/lib/stock-intelligence/scheduler/worker';

type ActionBody = {
  action?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ActionBody;
    const action = String(body.action || '').trim();
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    if (action === 'test_telegram') {
      await sendTelegramMessage(`Manual automation test ping @ ${new Date().toISOString()}`);
      return NextResponse.json({ ok: true, action });
    }

    if (action === 'test_alpaca') {
      const alpaca = await getAlpacaPaperStatus();
      return NextResponse.json({ ok: true, action, alpaca });
    }

    if (action === 'run_daily_now') {
      const result = await runDailyScan('manual-stock-user', true);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'run_refresh_now') {
      const result = await runIntradayRefresh('manual-stock-user', true);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'run_scheduler_tick') {
      const worker = createSchedulerWorker(process.env);
      await worker.init();
      await worker.tick();
      return NextResponse.json({ ok: true, action });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
