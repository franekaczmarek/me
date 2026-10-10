import { describe, expect, it } from "vitest";
import { addDays, dayTitle, daysBetween, deadlineLabel, formatMinutes } from "./format";

const TODAY = "2026-03-04"; // Wednesday

describe("to-do formatting", () => {
  it("names days relative to today", () => {
    expect(dayTitle(TODAY, TODAY)).toEqual({ name: "Today", date: "Wednesday, 4 March" });
    expect(dayTitle("2026-03-05", TODAY)).toEqual({ name: "Tomorrow", date: "Thursday, 5 March" });
    expect(dayTitle("2026-03-03", TODAY)).toEqual({ name: "Yesterday", date: "Tuesday, 3 March" });
    expect(dayTitle("2026-03-09", TODAY)).toEqual({ name: "Monday", date: "9 March" });
  });

  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("labels deadlines", () => {
    expect(deadlineLabel("2026-03-01", TODAY)).toEqual({ text: "3 days late", urgent: true });
    expect(deadlineLabel("2026-03-03", TODAY)).toEqual({ text: "1 day late", urgent: true });
    expect(deadlineLabel(TODAY, TODAY)).toEqual({ text: "due today", urgent: true });
    expect(deadlineLabel("2026-03-05", TODAY)).toEqual({ text: "due tomorrow", urgent: true });
    expect(deadlineLabel("2026-03-20", TODAY)).toEqual({ text: "due 20 Mar", urgent: false });
  });

  it("does date arithmetic across months", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays(TODAY, -4)).toBe("2026-02-28");
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
  });
});
