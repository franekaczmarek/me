import { describe, expect, it } from "vitest";
import {
  dayOf,
  daysInMonth,
  formatPartialDate,
  formatSpan,
  fromParts,
  initialWindow,
  periodEnd,
  periodStart,
  precisionOf,
  toParts,
} from "./dates";

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe("partial dates", () => {
  it("detects the precision", () => {
    expect(precisionOf("2015")).toBe("year");
    expect(precisionOf("2015-06")).toBe("month");
    expect(precisionOf("2015-06-17")).toBe("day");
  });

  it("computes the start of the period", () => {
    expect(ymd(periodStart("2015"))).toEqual([2015, 1, 1]);
    expect(ymd(periodStart("2015-06"))).toEqual([2015, 6, 1]);
    expect(ymd(periodStart("2015-06-17"))).toEqual([2015, 6, 17]);
  });

  it("computes the exclusive end of the period", () => {
    expect(ymd(periodEnd("2015"))).toEqual([2016, 1, 1]);
    expect(ymd(periodEnd("2015-06"))).toEqual([2015, 7, 1]);
    expect(ymd(periodEnd("2015-12"))).toEqual([2016, 1, 1]);
    expect(ymd(periodEnd("2015-06-30"))).toEqual([2015, 7, 1]);
    expect(ymd(periodEnd("2024-02-29"))).toEqual([2024, 3, 1]);
  });

  it("keeps years below 100 instead of mapping them to the 1900s", () => {
    expect(periodStart("0050").getFullYear()).toBe(50);
    expect(periodEnd("0099").getFullYear()).toBe(100);
  });

  it("formats for humans", () => {
    expect(formatPartialDate("2015")).toBe("2015");
    expect(formatPartialDate("2015-06")).toBe("June 2015");
    expect(formatPartialDate("2015-06-17")).toBe("17 June 2015");
  });

  it("formats points and periods", () => {
    expect(formatSpan("2015", null)).toBe("2015");
    expect(formatSpan("2015", "2018-06")).toBe("2015 – June 2018");
  });
});

describe("initialWindow", () => {
  const today = new Date(2026, 9, 10);

  it("spans the user's life with a margin when the birth date is known", () => {
    const { start, end } = initialWindow("1990-03-04", today);
    // 36 years of life -> 2-year margin on both sides.
    expect(ymd(start)).toEqual([1988, 1, 1]);
    expect(ymd(end)).toEqual([2029, 1, 1]);
  });

  it("uses at least a one-year margin for young users", () => {
    const { start, end } = initialWindow("2025-01-01", today);
    expect(ymd(start)).toEqual([2024, 1, 1]);
    expect(ymd(end)).toEqual([2028, 1, 1]);
  });

  it("falls back to the decade around today", () => {
    const { start, end } = initialWindow(null, today);
    expect(ymd(start)).toEqual([2021, 1, 1]);
    expect(ymd(end)).toEqual([2031, 1, 1]);
  });
});

describe("form date parts", () => {
  it("splits partial dates into form fields", () => {
    expect(toParts("2015")).toEqual({ year: "2015", month: "", day: "" });
    expect(toParts("2015-06-07")).toEqual({ year: "2015", month: "6", day: "7" });
    expect(toParts("0800-11")).toEqual({ year: "800", month: "11", day: "" });
    expect(toParts(null)).toEqual({ year: "", month: "", day: "" });
  });

  it("builds partial dates from form fields", () => {
    expect(fromParts({ year: "2015", month: "", day: "" })).toBe("2015");
    expect(fromParts({ year: "2015", month: "6", day: "" })).toBe("2015-06");
    expect(fromParts({ year: "800", month: "11", day: "7" })).toBe("0800-11-07");
    expect(fromParts({ year: "2024", month: "2", day: "29" })).toBe("2024-02-29");
  });

  it.each([
    [{ year: "", month: "", day: "" }, "Enter a year between 1 and 9999."],
    [{ year: "0", month: "", day: "" }, "Enter a year between 1 and 9999."],
    [{ year: "10000", month: "", day: "" }, "Enter a year between 1 and 9999."],
    [{ year: "20.5", month: "", day: "" }, "Enter a year between 1 and 9999."],
    [{ year: "2015", month: "", day: "3" }, "Choose a month for the day."],
    [{ year: "2023", month: "2", day: "29" }, "February 2023 has no day 29."],
    [{ year: "2015", month: "4", day: "31" }, "April 2015 has no day 31."],
  ])("rejects %o", (parts, message) => {
    expect(() => fromParts(parts)).toThrow(message);
  });

  it("counts days in a month", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 12)).toBe(31);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("turns a timeline click into a day", () => {
    expect(dayOf(new Date(2015, 5, 7, 13, 30))).toBe("2015-06-07");
  });
});
