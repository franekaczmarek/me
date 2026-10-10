import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR, escapeHtml, textColorFor, toItem, toItems } from "./items";
import type { Category, TimelineEvent } from "./types";

const event = (fields: Partial<TimelineEvent>): TimelineEvent => ({
  id: "e1",
  title: "Event",
  description: "",
  start: "2015-06-17",
  end: null,
  category_id: null,
  created_at: "",
  updated_at: "",
  ...fields,
});
const family: Category = { id: "c1", name: "Family", color: "#ffcc00" };
const ymd = (d?: Date) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe("toItem", () => {
  it("makes a point for a single day", () => {
    const item = toItem(event({}));
    expect(item.type).toBe("point");
    expect(ymd(item.start)).toEqual([2015, 6, 17]);
    expect(item.end).toBeUndefined();
    expect(item.className).toBe("me-item");
  });

  it("makes a range covering whole periods", () => {
    const item = toItem(event({ start: "2015", end: "2018-06" }));
    expect(item.type).toBe("range");
    expect(ymd(item.start)).toEqual([2015, 1, 1]);
    expect(ymd(item.end)).toEqual([2018, 7, 1]);
    expect(item.className).toBe("me-item");
  });

  it("draws a year-only point as an approximate range over that year", () => {
    const item = toItem(event({ start: "1931" }));
    expect(item.type).toBe("range");
    expect(ymd(item.start)).toEqual([1931, 1, 1]);
    expect(ymd(item.end)).toEqual([1932, 1, 1]);
    expect(item.className).toContain("me-approximate");
  });

  it("uses the category color with readable text", () => {
    const item = toItem(event({ category_id: "c1" }), family);
    expect(item.style).toBe("--item-color: #ffcc00; --item-text: #18181b;");
  });

  it("falls back to the default color", () => {
    expect(toItem(event({})).style).toContain(DEFAULT_COLOR);
  });

  it("escapes the title in the HTML content but keeps it raw in the tooltip", () => {
    const item = toItem(event({ title: '<img src=x onerror="alert(1)">' }));
    expect(item.content).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(item.title).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("toItems", () => {
  it("looks up categories and ignores unknown ones", () => {
    const [a, b] = toItems([event({ id: "a", category_id: "c1" }), event({ id: "b", category_id: "gone" })], [family]);
    expect(a.style).toContain("#ffcc00");
    expect(b.style).toContain(DEFAULT_COLOR);
  });
});

describe("helpers", () => {
  it("picks dark text on light colors and white on dark ones", () => {
    expect(textColorFor("#ffffff")).toBe("#18181b");
    expect(textColorFor("#000000")).toBe("#ffffff");
    expect(textColorFor("#1d4ed8")).toBe("#ffffff");
  });

  it("escapes all HTML special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
