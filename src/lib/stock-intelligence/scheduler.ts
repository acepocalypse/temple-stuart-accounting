import { runDailyScan, runIntradayRefresh } from './engine';
import { createSchedulerWorker } from './scheduler/worker';

export async function runDailyJob(): Promise<void> {
  await runDailyScan('manual-stock-user', true);
}

export async function runRefreshJob(): Promise<void> {
  await runIntradayRefresh('manual-stock-user', true);
}

export async function runSchedulerJob(): Promise<void> {
  const worker = createSchedulerWorker(process.env);
  await worker.runForever();
}
