/** Days are integers: days since 1970-01-01 (UTC). */
export type Day = number;
export const DAY_MS = 86_400_000;

export function toDay(iso: string): Day {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDay(day: Day): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function todayDay(): Day {
  const n = new Date();
  return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function ymd(day: Day) {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/** month is 0-based; overflow is normalized */
export function dayOf(y: number, m: number, d: number): Day {
  return Math.round(Date.UTC(y, m, d) / DAY_MS);
}

export function startOfWeek(day: Day): Day {
  return day - ((weekday(day) + 6) % 7); // Monday
}

export function startOfMonth(day: Day): Day {
  const { y, m } = ymd(day);
  return dayOf(y, m, 1);
}

export function startOfQuarter(day: Day): Day {
  const { y, m } = ymd(day);
  return dayOf(y, m - (m % 3), 1);
}

export function startOfYear(day: Day): Day {
  return dayOf(ymd(day).y, 0, 1);
}

export function addMonths(day: Day, n: number): Day {
  const { y, m, d } = ymd(day);
  return dayOf(y, m + n, d);
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function weekdayLabel(day: Day) {
  return WD[weekday(day)];
}

export function fmtShort(day: Day | null): string {
  if (day == null) return '';
  const { m, d } = ymd(day);
  return `${m + 1}/${d}`;
}

export function fmtLong(day: Day | null): string {
  if (day == null) return '';
  const { y, m, d } = ymd(day);
  return `${y}.${String(m + 1).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
}

/* ---------------- Working calendar ---------------- */

export interface WorkCal {
  workingDays: Set<number>;
  holidays: Set<Day>;
  /** when false every day counts as a working day */
  enabled: boolean;
}

export function makeCal(workingDays: number[], holidays: string[], enabled: boolean): WorkCal {
  return {
    workingDays: new Set(workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6]),
    holidays: new Set(holidays.map(toDay)),
    enabled,
  };
}

export function isWorking(cal: WorkCal, day: Day): boolean {
  if (!cal.enabled) return true;
  return cal.workingDays.has(weekday(day)) && !cal.holidays.has(day);
}

export function isOffDay(cal: WorkCal, day: Day): boolean {
  return !cal.workingDays.has(weekday(day)) || cal.holidays.has(day);
}

export function nextWorking(cal: WorkCal, day: Day): Day {
  let d = day;
  for (let i = 0; i < 400 && !isWorking(cal, d); i++) d++;
  return d;
}

/** inclusive count of working days between a and b */
export function workingDaysBetween(cal: WorkCal, a: Day, b: Day): number {
  if (b < a) return 0;
  if (!cal.enabled) return b - a + 1;
  let n = 0;
  for (let d = a; d <= b; d++) if (isWorking(cal, d)) n++;
  return n;
}

/** returns end day so that [start, end] contains n working days (n >= 1) */
export function addWorking(cal: WorkCal, start: Day, n: number): Day {
  if (n <= 1) return start;
  if (!cal.enabled) return start + n - 1;
  let d = start;
  let count = isWorking(cal, d) ? 1 : 0;
  let guard = 0;
  while (count < n && guard++ < 5000) {
    d++;
    if (isWorking(cal, d)) count++;
  }
  return d;
}
