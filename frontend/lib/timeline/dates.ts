// Turning partial dates into spans on the timeline, and the initial view.
import type { PartialDate } from "./types";

type Precision = "year" | "month" | "day";

function parts(value: PartialDate): { year: number; month: number; day: number; precision: Precision } {
  const [year, month, day] = value.split("-").map(Number);
  const precision: Precision = day ? "day" : month ? "month" : "year";
  return { year, month: month || 1, day: day || 1, precision };
}

// `new Date(y, ...)` maps years 0–99 to 1900–1999, so set the year explicitly.
function localDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(2000, monthIndex, day);
  date.setFullYear(year, monthIndex, day);
  return date;
}

export function precisionOf(value: PartialDate): Precision {
  return parts(value).precision;
}

/** First moment of the period: "2015-06" -> 1 June 2015 00:00. */
export function periodStart(value: PartialDate): Date {
  const { year, month, day } = parts(value);
  return localDate(year, month - 1, day);
}

/** First moment after the period (exclusive end): "2015-06" -> 1 July 2015 00:00. */
export function periodEnd(value: PartialDate): Date {
  const { year, month, day, precision } = parts(value);
  if (precision === "year") return localDate(year + 1, 0, 1);
  if (precision === "month") return localDate(year, month, 1);
  return localDate(year, month - 1, day + 1);
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Human-readable: "2015", "June 2015", "17 June 2015". */
export function formatPartialDate(value: PartialDate): string {
  const precision = precisionOf(value);
  if (precision === "year") return String(parts(value).year);
  return (precision === "month" ? MONTH : DAY).format(periodStart(value));
}

/** "2015 – June 2018" for periods, the single date for points. */
export function formatSpan(start: PartialDate, end: PartialDate | null): string {
  return end ? `${formatPartialDate(start)} – ${formatPartialDate(end)}` : formatPartialDate(start);
}

/**
 * What the timeline shows when it opens: the user's life so far (birth to today)
 * with some margin, or the decade around today when the birth date is unknown.
 */
export function initialWindow(birthDate: string | null, today: Date = new Date()): { start: Date; end: Date } {
  const year = today.getFullYear();
  if (birthDate) {
    const birth = periodStart(birthDate);
    const margin = Math.max(1, Math.round((year - birth.getFullYear()) * 0.05));
    return { start: localDate(birth.getFullYear() - margin, 0, 1), end: localDate(year + margin + 1, 0, 1) };
  }
  return { start: localDate(year - 5, 0, 1), end: localDate(year + 5, 0, 1) };
}

export type DateParts = { year: string; month: string; day: string };

export function toParts(value: PartialDate | null): DateParts {
  const [year = "", month = "", day = ""] = value ? value.split("-") : [];
  return { year: year.replace(/^0+(?=\d)/, ""), month: month.replace(/^0/, ""), day: day.replace(/^0/, "") };
}

/** Builds "YYYY", "YYYY-MM" or "YYYY-MM-DD" from form fields; throws a readable error. */
export function fromParts({ year, month, day }: DateParts): PartialDate {
  const y = Number(year);
  if (!year.trim() || !Number.isInteger(y) || y < 1 || y > 9999) throw new Error("Enter a year between 1 and 9999.");
  const yyyy = String(y).padStart(4, "0");
  if (!month) {
    if (day) throw new Error("Choose a month for the day.");
    return yyyy;
  }
  const mm = month.padStart(2, "0");
  if (!day) return `${yyyy}-${mm}`;
  const d = Number(day);
  if (d > daysInMonth(y, Number(month))) throw new Error(`${formatPartialDate(`${yyyy}-${mm}`)} has no day ${d}.`);
  return `${yyyy}-${mm}-${day.padStart(2, "0")}`;
}

/** `month` is 1–12. Day 0 of the next month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return localDate(year, month, 0).getDate();
}

/** Full-day partial date for a moment on the timeline (e.g. a double click). */
export function dayOf(date: Date): PartialDate {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
