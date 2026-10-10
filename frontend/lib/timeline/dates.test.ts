import { describe, expect, it } from "vitest";
import { formatPartialDate, formatSpan, initialWindow, periodEnd, periodStart, precisionOf } from "./dates";

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
