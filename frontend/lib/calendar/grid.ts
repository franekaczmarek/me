// Calendar grid maths: month matrix (weeks start on Monday) and event bars laid out in lanes.
import { addDays, daysBetween, parseDay } from "@/lib/todo/format";
import type { Task } from "@/lib/todo/types";
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

/** What can be laid out in a row of days: an event occurrence or a task (always one day, after events). */
export type Layoutable = Pick<Occurrence, "start_date" | "end_date" | "all_day" | "start_time" | "title"> & { kind?: "task" };

export type Segment<T extends Layoutable = Occurrence> = {
  occurrence: T;
  /** 0–6 within the week. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The event started before / goes on after this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Bars of one week: longer and all-day events first, then timed ones, then tasks; each in the first free lane. */
export function weekSegments<T extends Layoutable>(week: string[], items: T[]): Segment<T>[] {
  const first = week[0];
  const last = week[week.length - 1];
  const visible = items
    .filter((o) => o.start_date <= last && o.end_date >= first)
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        daysBetween(b.start_date, b.end_date) - daysBetween(a.start_date, a.end_date) ||
        Number(a.kind === "task") - Number(b.kind === "task") ||
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
export function hiddenPerDay(segments: Segment<Layoutable>[], shown: number, days = 7): number[] {
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

// --- week / day time grid ------------------------------------------------------------

export const MINUTES_PER_DAY = 1440;
/** Drag and create snap to quarters of an hour. */
export const SNAP = 15;
/** Short events are drawn (and laid out) at least this long. */
export const MIN_VISIBLE = 20;

/** "15:30:00" → 930 */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 930 → "15:30"; the end of the day is "23:59" (a time can't be 24:00). */
export function timeOf(minutes: number): string {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const snap = (minutes: number, step = SNAP) => Math.round(minutes / step) * step;

/** Shown in the time grid: timed events within one day. Everything else goes to the all-day row. */
export const isTimedSingleDay = (o: Occurrence) => !o.all_day && o.start_date === o.end_date;

export type Placed = {
  occurrence: Occurrence;
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** Column within its group of overlapping events, and how many columns the group has. */
  col: number;
  cols: number;
};

/** Side-by-side columns for overlapping timed events of one day (like Google Calendar). */
export function layoutDay(occurrences: Occurrence[]): Placed[] {
  const items = occurrences
    .filter(isTimedSingleDay)
    .map((o) => {
      const start = minutesOf(o.start_time!);
      return { o, start, end: Math.max(minutesOf(o.end_time!), start + MIN_VISIBLE) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.o.title.localeCompare(b.o.title));

  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  let colEnds: number[] = [];
  const close = () => {
    for (const p of group) p.cols = colEnds.length;
    group = [];
    colEnds = [];
  };
  for (const { o, start, end } of items) {
    if (start >= groupEnd) {
      close();
      groupEnd = -1;
    }
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = end;
    const p = { occurrence: o, start, end, col, cols: 0 };
    group.push(p);
    placed.push(p);
    groupEnd = Math.max(groupEnd, end);
  }
  close();
  return placed;
}

// --- tasks in the calendar -----------------------------------------------------------

/** A to-do task placed on its planned day like an all-day item. */
export type TaskItem = Layoutable & { kind: "task"; task: Task; id: string; occurrence_date: string };

export function taskItems(tasks: Task[]): TaskItem[] {
  return tasks
    .filter((t) => t.planned_date)
    .map((task) => ({
      kind: "task",
      task,
      id: `task-${task.id}`,
      title: task.title,
      start_date: task.planned_date!,
      end_date: task.planned_date!,
      occurrence_date: task.planned_date!,
      all_day: true,
      start_time: null,
    }));
}

export type CalendarItem = Occurrence | TaskItem;

export const isTask = (item: CalendarItem): item is TaskItem => (item as TaskItem).kind === "task";
