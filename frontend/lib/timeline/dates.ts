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
