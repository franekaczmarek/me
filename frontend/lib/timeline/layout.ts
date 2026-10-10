// Geometry of the timeline: date <-> x, scale ticks, item positions and lanes, zoom and pan.
// Pure functions; the component only renders what they return.
import { paletteColorFor } from "@/lib/colors";
import { periodEnd, periodStart, precisionOf } from "./dates";
import type { Category, TimelineEvent } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365.25 * DAY;

/** Visible range in ms since epoch. */
export type Range = { start: number; end: number };

export const ZOOM_MIN = 7 * DAY;
export const ZOOM_MAX = 300 * YEAR;

export function xOf(time: number, range: Range, width: number): number {
  return ((time - range.start) / (range.end - range.start)) * width;
}

export function timeAt(x: number, range: Range, width: number): number {
  return range.start + (x / width) * (range.end - range.start);
}

/** Keeps the span between ZOOM_MIN and ZOOM_MAX, around the same centre. */
export function clampRange(range: Range): Range {
  const span = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, range.end - range.start));
  const centre = (range.start + range.end) / 2;
  return { start: centre - span / 2, end: centre + span / 2 };
}

/** Zoom by `factor` (< 1 zooms in) keeping `anchor` at the same place on screen. */
export function zoomAt(range: Range, anchor: number, factor: number): Range {
  const span = range.end - range.start;
  const newSpan = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, span * factor));
  const ratio = (anchor - range.start) / span;
  return { start: anchor - ratio * newSpan, end: anchor + (1 - ratio) * newSpan };
}

/** Move by a drag of `dx` pixels (dragging right shows earlier dates). */
export function panBy(range: Range, dx: number, width: number): Range {
  const shift = (dx / width) * (range.end - range.start);
  return { start: range.start - shift, end: range.end - shift };
}

// --- scale ticks -------------------------------------------------------------------

export type Tick = { time: number; x: number; label: string; major: boolean };

type Step = { unit: "year" | "month" | "day"; n: number };

const STEPS: Step[] = [
  { unit: "day", n: 1 },
  { unit: "day", n: 7 },
  { unit: "month", n: 1 },
  { unit: "month", n: 3 },
  { unit: "month", n: 6 },
  { unit: "year", n: 1 },
  { unit: "year", n: 2 },
  { unit: "year", n: 5 },
  { unit: "year", n: 10 },
  { unit: "year", n: 20 },
  { unit: "year", n: 50 },
  { unit: "year", n: 100 },
];
const STEP_MS = { day: DAY, month: YEAR / 12, year: YEAR };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localDate(year: number, month: number, day: number): Date {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date;
}

/** Scale ticks spaced at least `minSpacing` px apart, labelled for the zoom level. */
export function ticks(range: Range, width: number, minSpacing = 80): Tick[] {
  const span = range.end - range.start;
  const step = STEPS.find((s) => (STEP_MS[s.unit] * s.n * width) / span >= minSpacing) ?? STEPS[STEPS.length - 1];
  const first = new Date(range.start);
  const result: Tick[] = [];
  const push = (date: Date, label: string, major: boolean) => {
    const time = date.getTime();
    if (time >= range.start && time <= range.end) result.push({ time, x: xOf(time, range, width), label, major });
  };

  if (step.unit === "year") {
    let year = Math.floor(first.getFullYear() / step.n) * step.n;
    for (let date = localDate(year, 0, 1); date.getTime() <= range.end; date = localDate((year += step.n), 0, 1)) {
      push(date, String(year), year % (step.n < 10 ? 10 : step.n * 5) === 0);
    }
  } else if (step.unit === "month") {
    let year = first.getFullYear();
    let month = Math.floor(first.getMonth() / step.n) * step.n;
    for (let date = localDate(year, month, 1); date.getTime() <= range.end; ) {
      push(date, month === 0 ? String(year) : MONTHS[month], month === 0);
      month += step.n;
      if (month > 11) [year, month] = [year + 1, month - 12];
      date = localDate(year, month, 1);
    }
  } else {
    // Days: every day, or the 1st, 8th, 15th and 22nd for weekly steps.
    const days = step.n === 1 ? null : [1, 8, 15, 22];
    for (let date = localDate(first.getFullYear(), first.getMonth(), first.getDate()); date.getTime() <= range.end; ) {
      const d = date.getDate();
      if (!days || days.includes(d)) {
        push(date, d === 1 ? `${MONTHS[date.getMonth()]} ${date.getFullYear()}` : String(d), d === 1);
      }
      date = localDate(date.getFullYear(), date.getMonth(), d + 1);
    }
  }
  return result;
}

// --- items -------------------------------------------------------------------------

export type PointLayout = {
  kind: "point";
  id: string;
  title: string;
  color: string;
  x: number;
  /** Known only to the month/year: the period it may fall in. */
  span: [number, number] | null;
  lane: number;
  labelWidth: number;
};

export type PeriodLayout = {
  kind: "period";
  id: string;
  title: string;
  color: string;
  x1: number;
  x2: number;
  lane: number;
  labelWidth: number;
  /** False when the bar is too short and the label goes to its right. */
  labelInside: boolean;
};

export type Layout = { points: PointLayout[]; periods: PeriodLayout[]; pointLanes: number; periodLanes: number };

// Estimates for text-sm medium; only used to keep labels apart.
const CHAR_WIDTH = 7.8;
const LABEL_PADDING = 30;
export const MAX_LABEL_WIDTH = 220;
const GAP = 10;

export function labelWidth(title: string): number {
  return Math.min(MAX_LABEL_WIDTH, Math.round(title.length * CHAR_WIDTH + LABEL_PADDING));
}

/** Greedy lanes: each interval goes to the first lane where it doesn't overlap. */
function assignLanes(intervals: { left: number; right: number }[]): number[] {
  const laneEnds: number[] = [];
  return intervals.map(({ left, right }) => {
    let lane = laneEnds.findIndex((end) => end + GAP <= left);
    if (lane === -1) lane = laneEnds.push(right) - 1;
    else laneEnds[lane] = right;
    return lane;
  });
}

export function colorOf(event: TimelineEvent, categories: Map<string, Category>): string {
  return (event.category_id && categories.get(event.category_id)?.color) || paletteColorFor(event.id);
}

/** Positions every event for the visible range; points above the line, periods below. */
export function layoutItems(events: TimelineEvent[], categoryList: Category[], range: Range, width: number): Layout {
  const categories = new Map(categoryList.map((c) => [c.id, c]));
  const x = (time: number) => xOf(time, range, width);

  const points = events
    .filter((e) => !e.end)
    .map((e) => {
      const start = periodStart(e.start).getTime();
      const end = periodEnd(e.start).getTime();
      const exact = precisionOf(e.start) === "day";
      return {
        kind: "point" as const,
        id: e.id,
        title: e.title,
        color: colorOf(e, categories),
        x: x((start + end) / 2),
        span: exact ? null : ([x(start), x(end)] as [number, number]),
        lane: 0,
        labelWidth: labelWidth(e.title),
      };
    })
    .sort((a, b) => a.x - b.x);
  assignLanes(points.map((p) => ({ left: p.x - p.labelWidth / 2, right: p.x + p.labelWidth / 2 }))).forEach(
    (lane, i) => (points[i].lane = lane),
  );

  const periods = events
    .filter((e) => e.end)
    .map((e) => {
      const x1 = x(periodStart(e.start).getTime());
      const x2 = x(periodEnd(e.end!).getTime());
      const width = labelWidth(e.title);
      return {
        kind: "period" as const,
        id: e.id,
        title: e.title,
        color: colorOf(e, categories),
        x1,
        x2,
        lane: 0,
        labelWidth: width,
        labelInside: x2 - x1 >= width,
      };
    })
    .sort((a, b) => a.x1 - b.x1);
  assignLanes(periods.map((p) => ({ left: p.x1, right: p.labelInside ? p.x2 : p.x2 + 6 + p.labelWidth }))).forEach(
    (lane, i) => (periods[i].lane = lane),
  );

  const lanes = (items: { lane: number }[]) => items.reduce((max, i) => Math.max(max, i.lane + 1), 0);
  return { points, periods, pointLanes: lanes(points), periodLanes: lanes(periods) };
}

/** Range showing all events with some margin, or null when there are none. */
export function fitRange(events: TimelineEvent[]): Range | null {
  if (!events.length) return null;
  const starts = events.map((e) => periodStart(e.start).getTime());
  const ends = events.map((e) => periodEnd(e.end ?? e.start).getTime());
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  const margin = Math.max((end - start) * 0.08, 15 * DAY);
  return clampRange({ start: start - margin, end: end + margin });
}
