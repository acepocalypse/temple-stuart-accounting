export interface MarketWindowConfig {
  timeZone: string;
  windowStartEt: string;
  windowEndEt: string;
  dailyScanTimeEt: string;
  refreshMinutes: number;
}

export interface MarketTimeParts {
  dateKey: string;
  weekday: number;
  hour: number;
  minute: number;
}

function parseHHMM(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':').map((x) => Number(x));
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid HH:MM value: ${value}`);
  }
  return { hour: h, minute: m };
}

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function getMarketTimeParts(now: Date, timeZone: string): MarketTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(byType.get('year'));
  const month = Number(byType.get('month'));
  const day = Number(byType.get('day'));
  const hour = Number(byType.get('hour'));
  const minute = Number(byType.get('minute'));
  const weekdayRaw = byType.get('weekday') || '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayRaw] ?? 0;
  return {
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday,
    hour,
    minute,
  };
}

export function isMarketWeekday(parts: MarketTimeParts): boolean {
  return parts.weekday >= 1 && parts.weekday <= 5;
}

export function isWithinMarketWindow(
  now: Date,
  config: Pick<MarketWindowConfig, 'timeZone' | 'windowStartEt' | 'windowEndEt'>,
): boolean {
  const parts = getMarketTimeParts(now, config.timeZone);
  if (!isMarketWeekday(parts)) return false;
  const start = parseHHMM(config.windowStartEt);
  const end = parseHHMM(config.windowEndEt);
  const nowMins = toMinutes(parts.hour, parts.minute);
  const startMins = toMinutes(start.hour, start.minute);
  const endMins = toMinutes(end.hour, end.minute);
  return nowMins >= startMins && nowMins <= endMins;
}

export function getMarketDateKey(now: Date, timeZone: string): string {
  return getMarketTimeParts(now, timeZone).dateKey;
}

export function shouldRunDailyScanAt(
  now: Date,
  config: Pick<MarketWindowConfig, 'timeZone' | 'dailyScanTimeEt'>,
  lastDailyRunMarketDate: string | null,
): boolean {
  const parts = getMarketTimeParts(now, config.timeZone);
  if (!isMarketWeekday(parts)) return false;
  if (parts.dateKey === lastDailyRunMarketDate) return false;
  const daily = parseHHMM(config.dailyScanTimeEt);
  return toMinutes(parts.hour, parts.minute) >= toMinutes(daily.hour, daily.minute);
}

export function getRefreshSlotKey(
  now: Date,
  config: Pick<MarketWindowConfig, 'timeZone' | 'refreshMinutes'>,
): string {
  const parts = getMarketTimeParts(now, config.timeZone);
  const slotMinute = Math.floor(parts.minute / config.refreshMinutes) * config.refreshMinutes;
  return `${parts.dateKey}:${String(parts.hour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`;
}

export function shouldRunRefreshAt(
  now: Date,
  config: Pick<MarketWindowConfig, 'timeZone' | 'refreshMinutes' | 'windowStartEt' | 'windowEndEt'>,
  lastRefreshSlotKey: string | null,
): boolean {
  if (!isWithinMarketWindow(now, config)) return false;
  const slot = getRefreshSlotKey(now, config);
  return slot !== lastRefreshSlotKey;
}
