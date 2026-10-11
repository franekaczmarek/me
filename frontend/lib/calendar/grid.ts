// Calendar grid maths: month matrix (weeks start on Monday) and event bars laid out in lanes.
import { addDays, daysBetween, parseDay } from "@/lib/todo/format";
import type { Occurrence } from "./types";

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (day: string) => ((parseDay(day).getDay() + 6) % 7) + 1;

export const startOfWeek = (day: string) => addDays(day, 1 - isoWeekday(day));

export const startOfMonth = (day: string) => `${day.slice(0, 8)}01`;

/** First day of the month `months` away. */
export function addMonths(day: string, months: number): string {
  const date = parseDay(startOfMonth(day));
  date.setMonth(date.getMonth() + months);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-01`;
}

/** Six full weeks (Monday first) covering the month of `day`. */
export function monthGrid(day: string): string[][] {
  const first = startOfWeek(startOfMonth(day));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
}

export type Segment = {
  occurrence: Occurrence;
  /** 0–6 within the week. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The event started before / goes on after this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Bars of one week: longer and all-day events first, each in the first free lane. */
export function weekSegments(week: string[], occurrences: Occurrence[]): Segment[] {
  const first = week[0];
  const last = week[week.length - 1];
  const visible = occurrences
    .filter((o) => o.start_date <= last && o.end_date >= first)
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        daysBetween(b.start_date, b.end_date) - daysBetween(a.start_date, a.end_date) ||
        Number(b.all_day) - Number(a.all_day) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.title.localeCompare(b.title),
    );
  const laneEnds: number[] = [];
  return visible.map((occurrence) => {
    const startCol = Math.max(0, daysBetween(first, occurrence.start_date));
    const endCol = Math.min(week.length - 1, daysBetween(first, occurrence.end_date));
    let lane = laneEnds.findIndex((end) => end < startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = endCol;
    return {
      occurrence,
      startCol,
      endCol,
      lane,
      continuesBefore: occurrence.start_date < first,
      continuesAfter: occurrence.end_date > last,
    };
  });
}

/** How many segments covering each day of the week are in lanes ≥ `shown` (hidden behind "+N more"). */
export function hiddenPerDay(segments: Segment[], shown: number, days = 7): number[] {
  const hidden = Array<number>(days).fill(0);
  for (const s of segments) {
    if (s.lane < shown) continue;
    for (let col = s.startCol; col <= s.endCol; col++) hidden[col]++;
  }
  return hidden;
}

/** Occurrences touching `day`, all-day first, then by time. */
export function onDay(occurrences: Occurrence[], day: string): Occurrence[] {
  return occurrences
    .filter((o) => o.start_date <= day && o.end_date >= day)
    .sort(
      (a, b) =>
        Number(b.all_day) - Number(a.all_day) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.title.localeCompare(b.title),
    );
}
