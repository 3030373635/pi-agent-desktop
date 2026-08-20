/**
 * Build a full-height CSS expression with a Chrome 102-safe fallback.
 *
 * @param offsetPixels - Fixed vertical space to subtract from the viewport.
 * @returns A CSS height expression based on the shared app viewport variable.
 */
export function getAppViewportHeightCss(offsetPixels = 0): string {
  const viewportHeight = "var(--app-viewport-height, 100vh)";
  return offsetPixels === 0
    ? viewportHeight
    : `calc(${viewportHeight} - ${offsetPixels}px)`;
}

export type TranslucentColorName = "accent" | "danger" | "success" | "warning";

/**
 * Build a translucent theme color without the Chrome 111-only `color-mix()`.
 *
 * @param colorName - Semantic theme color with a matching `--*-rgb` variable.
 * @param opacity - Alpha value from 0 through 1.
 * @returns A Chrome 102-compatible rgba color expression.
 */
export function getTranslucentColorCss(
  colorName: TranslucentColorName,
  opacity: number,
): string {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError("Color opacity must be between 0 and 1.");
  }
  return `rgba(var(--${colorName}-rgb), ${opacity})`;
}
