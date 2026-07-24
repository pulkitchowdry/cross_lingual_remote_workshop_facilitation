export type FontSize = "normal" | "large" | "x-large";
export type ContrastMode = "standard" | "high";

export const FONT_SIZE_SEQUENCE: readonly FontSize[] = ["normal", "large", "x-large"];

export const FONT_SIZE_LABEL: Record<FontSize, string> = {
  normal: "Normal text",
  large: "Large text",
  "x-large": "Extra-large text",
};

/**
 * localStorage is written by whatever version of the app last ran in this
 * browser, so a stale enum value (or hand-edited devtools storage) must not
 * flow into a `data-*` attribute unchecked.
 */
export function isFontSize(value: unknown): value is FontSize {
  return typeof value === "string" && (FONT_SIZE_SEQUENCE as readonly string[]).includes(value);
}

export function isContrastMode(value: unknown): value is ContrastMode {
  return value === "standard" || value === "high";
}

export function nextFontSize(current: FontSize): FontSize {
  const index = FONT_SIZE_SEQUENCE.indexOf(current);
  return FONT_SIZE_SEQUENCE[(index + 1) % FONT_SIZE_SEQUENCE.length];
}

export function toggleContrastMode(current: ContrastMode): ContrastMode {
  return current === "high" ? "standard" : "high";
}
