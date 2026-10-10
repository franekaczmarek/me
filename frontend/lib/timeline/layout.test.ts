import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/colors";
import {
  clampRange,
  fitRange,
  labelWidth,
  layoutItems,
  panBy,
  type Range,
  ticks,
  timeAt,
  xOf,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
} from "./layout";
import type { Category, TimelineEvent } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const t = (y: number, m = 1, d = 1) => new Date(y, m - 1, d).getTime();
const range = (from: number, to: number): Range => ({ start: t(from), end: t(to) });
const event = (fields: Partial<TimelineEvent>): TimelineEvent => ({
  id: "e",
  title: "Event",
  description: "",
  start: "2015-06-17",
  end: null,
  category_id: null,
  created_at: "",
  updated_at: "",
  ...fields,
});

describe("coordinates", () => {
  it("maps dates to x and back", () => {
    const r = range(2000, 2010);
    expect(xOf(r.start, r, 1000)).toBe(0);
    expect(xOf(r.end, r, 1000)).toBe(1000);
    expect(timeAt(500, r, 1000)).toBeCloseTo((r.start + r.end) / 2);
  });

  it("zooms around an anchor that stays in place", () => {
    const r = range(2000, 2010);
    const anchor = t(2002);
    const zoomed = zoomAt(r, anchor, 0.5);
    expect(zoomed.end - zoomed.start).toBeCloseTo((r.end - r.start) / 2);
    expect(xOf(anchor, zoomed, 1000)).toBeCloseTo(xOf(anchor, r, 1000));
  });

  it("limits zooming in and out", () => {
    const r = range(2000, 2010);
    const inMost = zoomAt(r, t(2005), 1e-9);
    expect(inMost.end - inMost.start).toBeCloseTo(ZOOM_MIN);
    const outMost = zoomAt(r, t(2005), 1e9);
    expect(outMost.end - outMost.start).toBeCloseTo(ZOOM_MAX);
    const clamped = clampRange({ start: 0, end: 1 });
    expect(clamped.end - clamped.start).toBe(ZOOM_MIN);
  });

  it("pans: dragging right shows earlier dates", () => {
    const r = range(2000, 2010);
    const moved = panBy(r, 100, 1000);
    expect(moved.start).toBeLessThan(r.start);
    expect(moved.end - moved.start).toBe(r.end - r.start);
  });
});

describe("ticks", () => {
  const labels = (r: Range, width = 1000) => ticks(r, width).map((tick) => tick.label);

  it("uses 5 or 10 years for a lifetime, depending on the width", () => {
    expect(labels(range(1985, 2030), 1000)).toEqual(
      ["1985", "1990", "1995", "2000", "2005", "2010", "2015", "2020", "2025", "2030"],
    );
    expect(labels(range(1985, 2030), 500)).toEqual(["1990", "2000", "2010", "2020", "2030"]);
  });

  it("uses years, then half-years, for a few years", () => {
    expect(labels(range(2015, 2020), 500)).toEqual(["2015", "2016", "2017", "2018", "2019", "2020"]);
    expect(labels(range(2015, 2017), 500)).toEqual(["2015", "Jul", "2016", "Jul", "2017"]);
  });

  it("uses months within a year, labelling January with the year", () => {
    expect(labels({ start: t(2015, 11), end: t(2016, 3) })).toEqual(["Nov", "Dec", "2016", "Feb", "Mar"]);
  });

  it("uses days when zoomed in a lot", () => {
    expect(labels({ start: t(2015, 6, 1), end: t(2015, 6, 8) })).toEqual([
      "Jun 2015",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("marks major ticks and keeps them apart", () => {
    const result = ticks(range(1900, 2100), 1000);
    expect(result.find((tick) => tick.label === "2000")?.major).toBe(true);
    expect(ticks(range(1985, 2030), 1000).filter((tick) => tick.major).map((tick) => tick.label)).toEqual([
      "1990",
      "2000",
      "2010",
      "2020",
      "2030",
    ]);
    for (let i = 1; i < result.length; i++) expect(result[i].x - result[i - 1].x).toBeGreaterThanOrEqual(80);
  });

  it("works for early years", () => {
    expect(labels({ start: new Date(50, 0, 1).setFullYear(50), end: new Date(2000, 0, 1).setFullYear(70) })).toContain(
      "60",
    );
  });
});

describe("layoutItems", () => {
  const school: Category = { id: "c1", name: "School", color: "#56a8f5" };
  const r = range(2000, 2020);

  it("puts exact points on their day and approximate ones in the middle of their period", () => {
    const { points } = layoutItems(
      [event({ id: "a", start: "2010-01-01" }), event({ id: "b", start: "2010" })],
      [],
      r,
      2000,
    );
    const a = points.find((p) => p.id === "a")!;
    const b = points.find((p) => p.id === "b")!;
    expect(a.span).toBeNull();
    expect(a.x).toBeCloseTo(xOf(t(2010) + DAY / 2, r, 2000));
    expect(b.span).toEqual([xOf(t(2010), r, 2000), xOf(t(2011), r, 2000)]);
    expect(b.x).toBeCloseTo((b.span![0] + b.span![1]) / 2);
  });

  it("stacks overlapping point labels into lanes", () => {
    const { points, pointLanes } = layoutItems(
      [
        event({ id: "a", start: "2010-01-01", title: "Moved to a new city" }),
        event({ id: "b", start: "2010-01-10", title: "First job" }),
        event({ id: "c", start: "2018-01-01", title: "Far away" }),
      ],
      [],
      r,
      1000,
    );
    const lane = (id: string) => points.find((p) => p.id === id)!.lane;
    expect(lane("a")).toBe(0);
    expect(lane("b")).toBe(1);
    expect(lane("c")).toBe(0);
    expect(pointLanes).toBe(2);
  });

  it("lays periods below as bars, stacking overlaps", () => {
    const { periods, periodLanes } = layoutItems(
      [
        event({ id: "school", title: "School", start: "2005", end: "2010-06", category_id: "c1" }),
        event({ id: "job", title: "Job", start: "2009", end: "2015" }),
        event({ id: "later", title: "Later", start: "2016", end: "2018" }),
      ],
      [school],
      r,
      1000,
    );
    const byId = Object.fromEntries(periods.map((p) => [p.id, p]));
    expect(byId.school.x1).toBeCloseTo(xOf(t(2005), r, 1000));
    expect(byId.school.x2).toBeCloseTo(xOf(t(2010, 7), r, 1000));
    expect(byId.school.color).toBe("#56a8f5");
    expect([byId.school.lane, byId.job.lane, byId.later.lane]).toEqual([0, 1, 0]);
    expect(periodLanes).toBe(2);
  });

  it("moves the label next to a bar that is too short for it", () => {
    const { periods } = layoutItems([event({ start: "2010-01", end: "2010-02", title: "A long holiday" })], [], r, 1000);
    expect(periods[0].labelInside).toBe(false);
  });

  it("gives uncategorised events a palette colour", () => {
    const { points } = layoutItems([event({ id: "x" })], [], r, 1000);
    expect(PALETTE).toContain(points[0].color);
  });

  it("caps label width for long titles", () => {
    expect(labelWidth("x".repeat(500))).toBe(220);
  });
});

describe("fitRange", () => {
  it("covers all events with a margin", () => {
    const fit = fitRange([event({ start: "1990-03-04" }), event({ start: "2005", end: "2009" })])!;
    expect(fit.start).toBeLessThan(t(1990, 3, 4));
    expect(fit.end).toBeGreaterThan(t(2010));
  });

  it("is null without events", () => {
    expect(fitRange([])).toBeNull();
  });
});
