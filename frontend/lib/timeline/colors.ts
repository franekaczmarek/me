// Timeline colours: a soft, colourful palette and helpers to tint and darken it.

/** Coral, peach, butter, mint, sky, lavender, rose, teal. */
export const PALETTE = ["#ff7a6b", "#ffa36c", "#f2c14e", "#4cc9a0", "#56a8f5", "#9b87f5", "#f27fb2", "#3bbfc9"];

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** The colour at a given opacity, e.g. for soft backgrounds that work on light and dark pages. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A darker shade of the colour, readable as text on its own tint. */
export function darken(hex: string, amount = 0.4): string {
  return `#${rgb(hex)
    .map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A lighter shade of the colour, readable as text on dark backgrounds. */
export function lighten(hex: string, amount = 0.45): string {
  return `#${rgb(hex)
    .map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Stable palette colour for things without a category (same id, same colour). */
export function paletteColorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
