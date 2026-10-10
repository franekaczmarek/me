// Display helpers for the to-do module.

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Local midnight of a YYYY-MM-DD date. */
export function parseDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m - 1, d);
  return date;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** "Wednesday" + "4 March"; today/tomorrow/yesterday get a friendly name. */
export function dayTitle(value: string, today: string): { name: string; date: string } {
  const day = parseDay(value);
  const relative = { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" }[daysBetween(today, value)];
  return relative
    ? { name: relative, date: `${WEEKDAY.format(day)}, ${DAY_MONTH.format(day)}` }
    : { name: WEEKDAY.format(day), date: DAY_MONTH.format(day) };
}

/** 45 → "45m", 90 → "1h 30m", 120 → "2h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "due 6 Mar", "due today", "3 days late". */
export function deadlineLabel(deadline: string, today: string): { text: string; urgent: boolean } {
  const diff = daysBetween(today, deadline);
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? "" : "s"} late`, urgent: true };
  if (diff === 0) return { text: "due today", urgent: true };
  if (diff === 1) return { text: "due tomorrow", urgent: true };
  return { text: `due ${SHORT.format(parseDay(deadline))}`, urgent: false };
}

export function addDays(value: string, days: number): string {
  const date = parseDay(value);
  date.setDate(date.getDate() + days);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
