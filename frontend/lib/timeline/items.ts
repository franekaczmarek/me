// Mapping events to vis-timeline items.
import { periodEnd, periodStart, precisionOf } from "./dates";
import type { Category, TimelineEvent } from "./types";

export const DEFAULT_COLOR = "#71717a";

export type TimelineItem = {
  id: string;
  /** HTML; built from escaped user text only. */
  content: string;
  start: Date;
  end?: Date;
  type: "point" | "range";
  className: string;
  /** Sets the CSS variables used by the item styles in globals.css. */
  style: string;
  /** Native tooltip. */
  title: string;
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Black or white, whichever reads better on the given background. */
export function textColorFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? "#18181b" : "#ffffff";
}

/**
 * Periods become ranges. Points with a full date stay points; a point known only
 * to the month or year covers that month/year, drawn dashed to show it's approximate.
 */
export function toItem(event: TimelineEvent, category?: Category): TimelineItem {
  const color = category?.color ?? DEFAULT_COLOR;
  const exactPoint = !event.end && precisionOf(event.start) === "day";
  return {
    id: event.id,
    content: escapeHtml(event.title),
    start: periodStart(event.start),
    ...(exactPoint ? {} : { end: periodEnd(event.end ?? event.start) }),
    type: exactPoint ? "point" : "range",
    className: event.end || exactPoint ? "me-item" : "me-item me-approximate",
    style: `--item-color: ${color}; --item-text: ${textColorFor(color)};`,
    title: event.title,
  };
}

export function toItems(events: TimelineEvent[], categories: Category[]): TimelineItem[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return events.map((e) => toItem(e, e.category_id ? byId.get(e.category_id) : undefined));
}
