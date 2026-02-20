import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_SCHEDULER_STATE,
  loadSchedulerState,
  markNotification,
  saveSchedulerState,
  shouldThrottleNotification,
} from '../notify/state';

test('scheduler state save/load and notification throttle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scheduler-state-'));
  const path = join(dir, 'state.json');
  const seeded = {
    ...DEFAULT_SCHEDULER_STATE,
    lastDailyRunMarketDate: '2026-02-20',
  };
  await saveSchedulerState(path, seeded);
  const loaded = await loadSchedulerState(path);
  assert.equal(loaded.lastDailyRunMarketDate, '2026-02-20');

  const now = '2026-02-20T15:00:00.000Z';
  const marked = markNotification(loaded, 'error:x', now);
  assert.equal(shouldThrottleNotification(marked, 'error:x', '2026-02-20T15:10:00.000Z'), true);
  assert.equal(shouldThrottleNotification(marked, 'error:x', '2026-02-20T16:00:01.000Z'), false);
});
