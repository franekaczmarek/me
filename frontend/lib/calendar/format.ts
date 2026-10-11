// Display helpers for the calendar.
import { parseDay } from "@/lib/todo/format";

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const LONG_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** "October 2026" */
export const monthTitle = (day: string) => MONTH_YEAR.format(parseDay(day));

/** "Sun 25 Oct" */
export const shortDay = (day: string) => SHORT_DAY.format(parseDay(day));

/** "Sunday 25 October" */
export const longDay = (day: string) => LONG_DAY.format(parseDay(day));

/** "15:30:00" → "15:30" */
export const formatTime = (value: string) => value.slice(0, 5);

/** "Today", "Tomorrow", "in 14 days" */
export function countdown(daysUntil: number): string {
  if (daysUntil <= 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `in ${daysUntil} days`;
}

/** "Sun 25 Oct", "Sun 25 Oct · 15:30", "Fri 9 Oct – Mon 12 Oct" */
export function when(o: { start_date: string; end_date: string; start_time: string | null }): string {
  const range = o.start_date === o.end_date ? shortDay(o.start_date) : `${shortDay(o.start_date)} – ${shortDay(o.end_date)}`;
  return o.start_time ? `${range} · ${formatTime(o.start_time)}` : range;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_ONLY = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const FULL_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "12 – 18 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2026 – 3 Jan 2027" */
export function weekTitle(first: string, last: string): string {
  const a = parseDay(first);
  const b = parseDay(last);
  if (a.getFullYear() !== b.getFullYear()) return `${DAY_MONTH.format(a)} ${a.getFullYear()} – ${DAY_MONTH.format(b)} ${b.getFullYear()}`;
  const start = a.getMonth() === b.getMonth() ? DAY_ONLY.format(a) : DAY_MONTH.format(a);
  return `${start} – ${DAY_MONTH.format(b)} ${b.getFullYear()}`;
}

/** "Wednesday, 14 October 2026" */
export const fullDay = (day: string) => FULL_DAY.format(parseDay(day));
