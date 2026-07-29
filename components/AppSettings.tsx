"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AppComponentReleaseInfo, AppUpdatesResponse } from "@/lib/app-update-types";
import {
  APP_DISTRIBUTION_NAME,
  APP_REPOSITORY,
  APP_REPOSITORY_URL,
  APP_VERSION_DISPLAY,
  PRODUCT_NAME,
} from "@/lib/branding";
import {
  installLatestDesktopRelease,
  type DesktopUpgradeProgress,
} from "@/lib/desktop-updater";

function VersionValue({ component }: { component: AppComponentReleaseInfo }) {
  if (component.releaseStatus === "unknown") {
    return <span style={{ color: "var(--text-dim)" }}>Unavailable</span>;
  }
  if (component.releaseStatus === "unpublished" || !component.latestVersion) {
    return <span style={{ color: "var(--text-dim)" }}>No releases</span>;
  }
  return (
    <span style={{ color: component.updateAvailable ? "var(--accent)" : "var(--text-muted)" }}>
      v{component.latestVersion}
    </span>
  );
}

export function AppSettings({ onClose }: { onClose: () => void }) {
  const [components, setComponents] = useState<AppComponentReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgradeProgress, setUpgradeProgress] = useState<DesktopUpgradeProgress | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/updates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AppUpdatesResponse>;
      })
      .then((data) => {
        const list = Array.isArray(data.components) ? data.components : [];
        setComponents(list.filter((component) => component.project !== "pi-web"));
        setLoadError(null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("Could not check GitHub releases.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !upgradeProgress) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, upgradeProgress]);

  const appRelease = useMemo(
    () => components.find((component) => component.project === "pi-agent-desktop"),
    [components],
  );
  const pendingUpdates = useMemo(
    () => components.filter((component) => component.updateAvailable),
    [components],
  );
  const canUpgrade = !loading && pendingUpdates.length > 0 && !upgradeProgress;
  const downloadPercent = upgradeProgress?.phase === "downloading"
    && upgradeProgress.totalBytes
    ? Math.min(100, Math.round((upgradeProgress.downloadedBytes ?? 0) / upgradeProgress.totalBytes * 100))
    : null;
  const upgradeLabel = upgradeProgress?.phase === "checking"
    ? "Preparing update…"
    : upgradeProgress?.phase === "downloading"
      ? `Downloading${downloadPercent === null ? "…" : ` ${downloadPercent}%`}`
      : upgradeProgress?.phase === "installing"
        ? "Installing and restarting…"
        : pendingUpdates.length > 0
          ? `Upgrade ${pendingUpdates.length} ${pendingUpdates.length === 1 ? "component" : "components"}`
          : loading
            ? "Checking…"
            : "Up to date";

  const handleUpgrade = async () => {
    if (!canUpgrade) return;
    setUpgradeError(null);
    try {
      const result = await installLatestDesktopRelease(setUpgradeProgress);
      if (!result.installed) {
        setUpgradeProgress(null);
        setUpgradeError(
          "The component updates are detected, but a signed pi-agent-desktop bundle containing them has not been published yet.",
        );
      }
    } catch (error) {
      setUpgradeProgress(null);
      setUpgradeError(error instanceof Error ? error.message : String(error));
    }
  };

  const upgradeStyle: CSSProperties = {
    minWidth: 150,
  };

  return (
    <div
      className="native-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !upgradeProgress) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <section
        className="native-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(720px, calc(100vh - 36px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-panel)",
          color: "var(--text)",
          boxShadow: "0 22px 70px rgba(0,0,0,0.32)",
        }}
      >
        <header className="native-modal-header" style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "20px 22px 17px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="native-modal-title" id="app-settings-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}>
              {PRODUCT_NAME}
            </h2>
            <div style={{ marginTop: 5, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
              {PRODUCT_NAME} 将 pi 编码智能体的全部能力封进一个优雅的桌面 App。
              <br />
              浏览会话、实时对话、管理模型与 Skills —— 一切数据都留在你的电脑上。
            </div>
            <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <a
                href={APP_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                {APP_REPOSITORY}
                <span aria-hidden="true" style={{ marginLeft: 4, color: "var(--text-dim)" }}>↗</span>
              </a>
              <span style={{ color: "var(--text-dim)" }}>·</span>
              <span style={{ color: "var(--text-muted)" }}>v{APP_VERSION_DISPLAY}</span>
            </div>
          </div>
          <button
            className="native-modal-close"
            type="button"
            onClick={onClose}
            disabled={Boolean(upgradeProgress)}
            aria-label="Close settings"
            title="Close"
            style={{ padding: "1px 5px", border: 0, background: "transparent", color: "var(--text-muted)", cursor: upgradeProgress ? "default" : "pointer", fontSize: 21, lineHeight: 1, opacity: upgradeProgress ? 0.35 : 1 }}
          >
            ×
          </button>
        </header>

        <div style={{ overflowY: "auto", padding: "18px 22px 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Components</div>
            <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
              This app combines the following open-source projects. GitHub Release versions are checked once a week.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {loading ? (
              <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                Checking GitHub releases…
              </div>
            ) : components.length > 0 ? components.map((component) => (
              <div
                className="native-settings-card"
                key={component.project}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px, 1fr) auto auto",
                  alignItems: "center",
                  gap: "10px 18px",
                  padding: "12px 13px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <a
                    href={component.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}
                  >
                    {component.repository}
                    <span aria-hidden="true" style={{ marginLeft: 5, color: "var(--text-dim)" }}>↗</span>
                  </a>
                </div>
                <div style={{ minWidth: 74 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Bundled</div>
                  <div style={{ marginTop: 3, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    v{component.project === "pi-agent-desktop" ? APP_VERSION_DISPLAY : component.currentVersion}
                  </div>
                </div>
                <div style={{ minWidth: 84 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>GitHub Release</div>
                  <div style={{ marginTop: 3, fontFamily: "var(--font-mono)", fontSize: 11 }}><VersionValue component={component} /></div>
                </div>
              </div>
            )) : (
              <div style={{ padding: "20px 12px", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-muted)", fontSize: 12 }}>
                {loadError ?? "Release information is unavailable."}
              </div>
            )}
          </div>

          {loadError && components.length > 0 && (
            <div className="native-inline-alert is-error" style={{ marginTop: 10 }}>{loadError}</div>
          )}
          {upgradeError && (
            <div className="native-inline-alert is-error" role="alert" style={{ marginTop: 10 }}>
              {upgradeError}
              {appRelease?.releaseUrl && (
                <a href={appRelease.releaseUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "inherit", fontWeight: 650 }}>
                  Open release
                </a>
              )}
            </div>
          )}
        </div>

        <footer className="settings-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 22px", borderTop: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
            {pendingUpdates.length > 0
              ? `${pendingUpdates.map((component) => component.name).join(" → ")} will be updated through one signed ${APP_DISTRIBUTION_NAME} release.`
              : `Upgrading installs a complete signed ${APP_DISTRIBUTION_NAME} release.`}
          </span>
          <button className="native-button native-button-primary" type="button" disabled={!canUpgrade} onClick={() => void handleUpgrade()} style={upgradeStyle}>
            {upgradeLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
