"use client";

import { useEffect } from "react";

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
}

interface ViewportHeightValueState extends ViewportHeightState {
  supportsDynamicViewport: boolean;
}

export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  innerHeight,
  viewportHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  const isUnscaled = Math.abs(viewportScale - 1) < 0.01;
  return hasFocusedEditable && isUnscaled && innerHeight - viewportHeight > 1;
}

/**
 * Resolve the app height for the current viewport and browser capabilities.
 *
 * @param state - Current viewport measurements, focus state, and `dvh` support.
 * @returns A CSS height that remains valid in Chrome 102 and newer browsers.
 */
export function resolveViewportHeightValue(state: ViewportHeightValueState): string {
  if (shouldUseVisualViewportHeight(state)) {
    return `${state.viewportHeight}px`;
  }
  return state.supportsDynamicViewport ? "100dvh" : "100vh";
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const supportsDynamicViewport = typeof CSS !== "undefined"
      && CSS.supports("height", "100dvh");

    const update = () => {
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const height = resolveViewportHeightValue({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        supportsDynamicViewport,
        viewportHeight,
        viewportScale: viewport?.scale ?? 1,
      });
      // Always expose a supported value so inline `var()` declarations never
      // fall back to the unsupported `dvh` unit in Chrome 102.
      root.style.setProperty("--app-viewport-height", height);

      if (height.endsWith("px")) {
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      }
    };

    update();
    if (!viewport) {
      return () => {
        root.style.removeProperty("--app-viewport-height");
      };
    }

    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
