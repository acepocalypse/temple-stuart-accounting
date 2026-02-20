function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

export function toIsoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function tradingDaysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() === end.getTime()) return 0;
  const step = end > start ? 1 : -1;
  const cursor = new Date(start);
  let count = 0;
  while (cursor.getTime() !== end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (isWeekday(cursor)) count += step;
  }
  return count;
}

export function nowIso(): string {
  return new Date().toISOString();
}

