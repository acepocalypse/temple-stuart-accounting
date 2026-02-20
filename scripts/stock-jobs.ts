import { runDailyJob, runRefreshJob } from '../src/lib/stock-intelligence/scheduler';

async function main() {
  const mode = process.argv[2];
  if (mode === 'daily') {
    await runDailyJob();
    console.log('daily job completed');
    return;
  }
  if (mode === 'refresh') {
    await runRefreshJob();
    console.log('refresh job completed');
    return;
  }
  throw new Error('Usage: node --import tsx scripts/stock-jobs.ts <daily|refresh>');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
