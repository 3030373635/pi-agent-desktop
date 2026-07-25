"use client";

import { useEffect, useState } from "react";
import type { AppUpdateInfo, AppUpdatesResponse } from "@/lib/api-types";
import { PRODUCT_NAME } from "@/lib/branding";

const RETRY_AFTER_ERROR_MS = 6 * 60 * 60 * 1000;
const MAX_TIMER_MS = 2_147_000_000;

export function UpdateReminder({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [updates, setUpdates] = useState<AppUpdateInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(runCheck, Math.min(MAX_TIMER_MS, Math.max(60_000, delay)));
    };

    const runCheck = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/updates", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as AppUpdatesResponse;
        if (cancelled) return;
        if (Array.isArray(data.updates) && data.updates.length > 0) {
          setUpdates(data.updates);
        }
        const nextCheckAt = Date.parse(data.nextCheckAt);
        schedule(Number.isFinite(nextCheckAt) ? nextCheckAt - Date.now() : RETRY_AFTER_ERROR_MS);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        schedule(RETRY_AFTER_ERROR_MS);
      }
    };

    void runCheck();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (updates.length === 0) return null;

  const handleOpenSettings = () => {
    setUpdates([]);
    onOpenSettings();
  };

  return (
    <aside
      className="native-update-reminder"
      aria-label="Available updates"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1200,
        width: "min(380px, calc(100vw - 32px))",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-panel)",
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.24)",
        color: "var(--text)",
        overflow: "hidden",
      }}
    >
      <div className="native-update-reminder-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 10px" }}>
        <div className="native-update-reminder-title" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span className="native-update-reminder-icon" aria-hidden="true" style={{ color: "var(--accent)", fontSize: 16 }}>↑</span>
          Updates available
        </div>
        <button
          className="native-modal-close"
          type="button"
          aria-label="Dismiss update reminder"
          title="Remind me next week"
          onClick={() => setUpdates([])}
          style={{
            padding: "1px 5px",
            border: 0,
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 19,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div className="native-update-reminder-body" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 14px 12px" }}>
        {updates.map((update) => (
          <div
            className="native-update-reminder-row"
            key={update.project}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "9px 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 650 }}>{update.name}</div>
              <div style={{ marginTop: 3, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                {update.currentVersion} → {update.latestVersion}
              </div>
            </div>
            <a
              className="native-update-reminder-link"
              href={update.releaseUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                flexShrink: 0,
                color: "var(--accent)",
                fontSize: 11,
                fontWeight: 650,
                textDecoration: "none",
              }}
            >
              View release
            </a>
          </div>
        ))}
        <div className="native-update-reminder-caption" style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.45 }}>
          {PRODUCT_NAME} checks official GitHub releases once a week. Review and install one complete signed app update in Settings.
        </div>
        <button
          className="native-button native-button-primary"
          type="button"
          onClick={handleOpenSettings}
          style={{ alignSelf: "flex-end" }}
        >
          Open Settings
        </button>
      </div>
    </aside>
  );
}
