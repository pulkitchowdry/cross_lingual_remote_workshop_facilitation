export type ThemeName = "beige" | "ink-copper" | "slate-night" | "warm-dusk";

export const THEME_SEQUENCE: readonly ThemeName[] = ["beige", "ink-copper", "slate-night", "warm-dusk"];

export const DEFAULT_THEME: ThemeName = "slate-night";

/**
 * localStorage is written by whatever version of the app last ran in this
 * browser, so a stale enum value (or hand-edited devtools storage) must not
 * flow into a `data-*` attribute unchecked.
 */
export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_SEQUENCE as readonly string[]).includes(value);
}

export function nextTheme(current: ThemeName): ThemeName {
  const index = THEME_SEQUENCE.indexOf(current);
  return THEME_SEQUENCE[(index + 1) % THEME_SEQUENCE.length];
}
