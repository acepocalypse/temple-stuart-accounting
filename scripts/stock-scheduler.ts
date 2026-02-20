import { createSchedulerWorker } from '../src/lib/stock-intelligence/scheduler/worker';

async function main() {
  const worker = createSchedulerWorker(process.env);

  const shutdown = () => {
    worker.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await worker.runForever();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
