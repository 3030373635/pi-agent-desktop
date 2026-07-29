"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem("pi-theme");
    return t === "dark" || t === "light" ? t : null;
  } catch {
    return null;
  }
}

// Follow the OS appearance until the user picks a theme explicitly
// (toggleTheme persists the choice, which stops the auto-follow).
if (typeof window !== "undefined") {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", (event) => {
    if (storedTheme() !== null) return;
    document.documentElement.classList.toggle("dark", event.matches);
    listeners.forEach((cb) => cb());
  });
}

function applyTheme(next: Theme) {
  const apply = () => {
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try {
      localStorage.setItem("pi-theme", next);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
    listeners.forEach((cb) => cb());
  };

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const supportsVT = typeof document.startViewTransition === "function";

  if (!supportsVT || reduceMotion) {
    apply();
    return;
  }

  try {
    const transition = document.startViewTransition(apply);
    // A navigation or rapid second toggle can legitimately abort a transition.
    // Consume those promise rejections so they do not surface as app errors.
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(() => {});
    void transition.finished.catch(() => {});
  } catch {
    apply();
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    applyTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    if (getSnapshot() === next) return;
    applyTheme(next);
  }, []);

  return { theme, toggleTheme, setTheme, isDark: theme === "dark" };
}
