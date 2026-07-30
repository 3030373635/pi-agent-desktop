"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DesktopConnectionState = "online" | "offline" | "checking";

const PING_INTERVAL_MS = 8_000;
const OFFLINE_THRESHOLD = 2;

/**
 * Lightweight local-server health probe. Used to surface a reconnect banner
 * when the packaged Next server or SSE streams drop.
 */
export function useDesktopConnection(): {
  state: DesktopConnectionState;
  retry: () => void;
} {
  const [state, setState] = useState<DesktopConnectionState>("checking");
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const probe = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);
    try {
      const res = await fetch(`/api/home?_=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (stoppedRef.current) return;
      failuresRef.current = 0;
      setState("online");
    } catch {
      if (stoppedRef.current) return;
      failuresRef.current += 1;
      if (failuresRef.current >= OFFLINE_THRESHOLD) {
        setState("offline");
      } else {
        setState((prev) => (prev === "offline" ? "offline" : "checking"));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  // A probe that is still in flight at unmount resolves after cleanup ran, so
  // it would queue a timer nobody owns and keep pinging forever.
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (stoppedRef.current) return;
    timerRef.current = setTimeout(() => {
      void probe().finally(() => schedule());
    }, PING_INTERVAL_MS);
  }, [probe]);

  const retry = useCallback(() => {
    setState("checking");
    failuresRef.current = 0;
    void probe();
  }, [probe]);

  useEffect(() => {
    stoppedRef.current = false;
    void probe().finally(() => schedule());

    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    const onOnline = () => retry();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [probe, retry, schedule]);

  return { state, retry };
}
