import { runDailyScan, runIntradayRefresh } from './engine';

export async function runDailyJob(): Promise<void> {
  await runDailyScan('manual-stock-user', true);
}

export async function runRefreshJob(): Promise<void> {
  await runIntradayRefresh('manual-stock-user', true);
}

