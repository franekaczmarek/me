import { describe, expect, it } from "vitest";
import { addMonths, hiddenPerDay, isoWeekday, monthGrid, onDay, startOfWeek, weekSegments } from "./grid";
import type { Occurrence } from "./types";

function occ(title: string, start: string, end = start, time: string | null = null): Occurrence {
  return {
    id: title,
    title,
    notes: "",
    location: "",
    start_date: start,
    end_date: end,
    start_time: time,
    end_time: time ? "23:00:00" : null,
    color: "#56a8f5",
    recurrence: "none",
    recurrence_until: null,
    add_to_timeline: false,
    timeline_event_id: null,
    all_day: time === null,
    occurrence_date: start,
  };
}

const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];

describe("calendar grid", () => {
  it("knows weekdays and week starts", () => {
    expect(isoWeekday("2026-10-11")).toBe(7);
    expect(isoWeekday("2026-10-12")).toBe(1);
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
  });

  it("moves between months", () => {
    expect(addMonths("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("builds six Monday-first weeks around the month", () => {
    const grid = monthGrid("2026-10-11");
    expect(grid).toHaveLength(6);
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid[0][3]).toBe("2026-10-01");
    expect(grid[5][6]).toBe("2026-11-08");
    expect(grid.flat()).toContain("2026-10-31");
  });

  it("lays bars out in lanes, longest first", () => {
    const segments = weekSegments(WEEK, [
      occ("Doctor", "2026-10-06", "2026-10-06", "15:30:00"),
      occ("Trip", "2026-10-03", "2026-10-06"),
      occ("Conference", "2026-10-06", "2026-10-14"),
      occ("Birthday", "2026-10-08"),
      occ("Next week", "2026-10-12"),
    ]);
    const byTitle = Object.fromEntries(segments.map((s) => [s.occurrence.title, s]));
    expect(Object.keys(byTitle)).toEqual(["Trip", "Conference", "Doctor", "Birthday"]);
    expect(byTitle.Trip).toMatchObject({ startCol: 0, endCol: 1, lane: 0, continuesBefore: true, continuesAfter: false });
    expect(byTitle.Conference).toMatchObject({ startCol: 1, endCol: 6, lane: 1, continuesAfter: true });
    expect(byTitle.Doctor).toMatchObject({ startCol: 1, lane: 2 });
    expect(byTitle.Birthday).toMatchObject({ startCol: 3, lane: 0 });
  });

  it("counts what does not fit", () => {
    const segments = weekSegments(WEEK, ["a", "b", "c", "d", "e"].map((t) => occ(t, "2026-10-07")));
    expect(hiddenPerDay(segments, 3)).toEqual([0, 0, 2, 0, 0, 0, 0]);
  });

  it("lists a day's events, all-day first", () => {
    const list = onDay(
      [occ("Late", "2026-10-07", "2026-10-07", "18:00:00"), occ("Early", "2026-10-07", "2026-10-07", "08:00:00"), occ("Trip", "2026-10-05", "2026-10-09"), occ("Other", "2026-10-08")],
      "2026-10-07",
    );
    expect(list.map((o) => o.title)).toEqual(["Trip", "Early", "Late"]);
  });
});
