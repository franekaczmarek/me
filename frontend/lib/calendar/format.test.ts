import { describe, expect, it } from "vitest";
import { countdown, formatTime, longDay, monthTitle, when } from "./format";

describe("calendar format", () => {
  it("formats months, days and times", () => {
    expect(monthTitle("2026-10-11")).toBe("October 2026");
    expect(longDay("2026-10-25")).toBe("Sunday 25 October");
    expect(formatTime("15:30:00")).toBe("15:30");
  });

  it("counts down", () => {
    expect(countdown(0)).toBe("Today");
    expect(countdown(1)).toBe("Tomorrow");
    expect(countdown(14)).toBe("in 14 days");
  });

  it("describes when an event happens", () => {
    expect(when({ start_date: "2026-10-25", end_date: "2026-10-25", start_time: null })).toBe("Sun 25 Oct");
    expect(when({ start_date: "2026-10-25", end_date: "2026-10-25", start_time: "15:30:00" })).toBe("Sun 25 Oct · 15:30");
    expect(when({ start_date: "2026-10-09", end_date: "2026-10-12", start_time: null })).toBe("Fri 9 Oct – Mon 12 Oct");
  });
});
