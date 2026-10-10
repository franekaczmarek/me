import { describe, expect, it } from "vitest";
import { darken, lighten, PALETTE, paletteColorFor, withAlpha } from "@/lib/colors";

describe("colors", () => {
  it("makes a translucent version of a colour", () => {
    expect(withAlpha("#ff7a6b", 0.2)).toBe("rgba(255, 122, 107, 0.2)");
  });

  it("darkens a colour", () => {
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(darken("#ff7a6b", 0)).toBe("#ff7a6b");
  });

  it("lightens a colour", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#ff7a6b", 0)).toBe("#ff7a6b");
  });

  it("gives the same palette colour to the same id", () => {
    expect(paletteColorFor("event-1")).toBe(paletteColorFor("event-1"));
    expect(PALETTE).toContain(paletteColorFor("event-1"));
  });

  it("spreads ids over the palette", () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => paletteColorFor(`id-${i}`)));
    expect(colors.size).toBeGreaterThan(4);
  });
});
