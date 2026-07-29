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
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";

const sectionCardStyle: CSSProperties = {
  padding: "13px 14px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
};

const sectionHintStyle: CSSProperties = {
  marginTop: 3,
  color: "var(--text-muted)",
  fontSize: 11,
  lineHeight: 1.5,
};

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="native-button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minWidth: 88,
        borderColor: active ? "var(--accent)" : "var(--border)",
        color: active ? "var(--accent)" : "var(--text-muted)",
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

export function AppSettings({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale, supportedLocales } = useI18n();
  const { theme, setTheme } = useTheme();
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
        setLoadError("checkFailed");
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
  const updateAvailable = pendingUpdates.length > 0;
  const canUpgrade = !loading && updateAvailable && !upgradeProgress;
  const downloadPercent = upgradeProgress?.phase === "downloading"
    && upgradeProgress.totalBytes
    ? Math.min(100, Math.round((upgradeProgress.downloadedBytes ?? 0) / upgradeProgress.totalBytes * 100))
    : null;
  const upgradeLabel = upgradeProgress?.phase === "checking"
    ? t("appSettings.preparing")
    : upgradeProgress?.phase === "downloading"
      ? (downloadPercent === null
        ? t("appSettings.downloading")
        : t("appSettings.downloadingPercent", { percent: downloadPercent }))
      : upgradeProgress?.phase === "installing"
        ? t("appSettings.installing")
        : t("appSettings.update");

  const latestReleaseText = loading
    ? "…"
    : !appRelease || appRelease.releaseStatus === "unknown"
      ? t("appSettings.releaseUnavailable")
      : appRelease.releaseStatus === "unpublished" || !appRelease.latestVersion
        ? t("appSettings.noReleases")
        : `v${appRelease.latestVersion}`;

  const statusText = loading
    ? t("appSettings.checkingReleases")
    : loadError
      ? t("appSettings.checkFailed")
      : updateAvailable
        ? t("appSettings.updateAvailable")
        : t("appSettings.upToDate");

  const handleUpgrade = async () => {
    if (!canUpgrade) return;
    setUpgradeError(null);
    try {
      const result = await installLatestDesktopRelease(setUpgradeProgress);
      if (!result.installed) {
        setUpgradeProgress(null);
        setUpgradeError(t("appSettings.noSignedBundle", { name: APP_DISTRIBUTION_NAME }));
      }
    } catch (error) {
      setUpgradeProgress(null);
      setUpgradeError(error instanceof Error ? error.message : String(error));
    }
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
              {t("appSettings.tagline", { product: PRODUCT_NAME })}
              <br />
              {t("appSettings.taglineDetails")}
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
            aria-label={t("appSettings.close")}
            title={t("appSettings.close")}
            style={{ padding: "1px 5px", border: 0, background: "transparent", color: "var(--text-muted)", cursor: upgradeProgress ? "default" : "pointer", fontSize: 21, lineHeight: 1, opacity: upgradeProgress ? 0.35 : 1 }}
          >
            ×
          </button>
        </header>

        <div style={{ overflowY: "auto", padding: "18px 22px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="native-settings-card" style={sectionCardStyle}>
            <div style={sectionTitleStyle}>{t("appSettings.updatesSection")}</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px" }}>
              <div>
                <div style={{ color: "var(--text-dim)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("appSettings.currentVersion")}
                </div>
                <div style={{ marginTop: 3, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  v{APP_VERSION_DISPLAY}
                </div>
              </div>
              <div>
                <div style={{ color: "var(--text-dim)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("appSettings.latestRelease")}
                </div>
                <div style={{ marginTop: 3, fontFamily: "var(--font-mono)", fontSize: 12, color: updateAvailable ? "var(--accent)" : "var(--text-muted)" }}>
                  {latestReleaseText}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: loadError ? "var(--text-dim)" : updateAvailable ? "var(--accent)" : "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
                {statusText}
              </span>
              {(updateAvailable || upgradeProgress) && (
                <button
                  className="native-button native-button-primary"
                  type="button"
                  disabled={!canUpgrade}
                  onClick={() => void handleUpgrade()}
                  style={{ minWidth: 120 }}
                >
                  {upgradeLabel}
                </button>
              )}
            </div>
            {updateAvailable && (
              <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.5 }}>
                {t("appSettings.updateNote", { name: APP_DISTRIBUTION_NAME })}
              </div>
            )}
            {upgradeError && (
              <div className="native-inline-alert is-error" role="alert" style={{ marginTop: 10 }}>
                {upgradeError}
                {appRelease?.releaseUrl && (
                  <a href={appRelease.releaseUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "inherit", fontWeight: 650 }}>
                    {t("appSettings.openRelease")}
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="native-settings-card" style={sectionCardStyle}>
            <div style={sectionTitleStyle}>{t("appSettings.languageSection")}</div>
            <div style={sectionHintStyle}>{t("appSettings.languageHint")}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {supportedLocales.map((plugin) => (
                <ChoiceButton
                  key={plugin.id}
                  active={locale === plugin.id}
                  onClick={() => setLocale(plugin.id as typeof locale)}
                >
                  {plugin.label}
                </ChoiceButton>
              ))}
            </div>
          </div>

          <div className="native-settings-card" style={sectionCardStyle}>
            <div style={sectionTitleStyle}>{t("appSettings.appearanceSection")}</div>
            <div style={sectionHintStyle}>{t("appSettings.appearanceHint")}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <ChoiceButton active={theme === "light"} onClick={() => setTheme("light")}>
                {t("appSettings.themeLight")}
              </ChoiceButton>
              <ChoiceButton active={theme === "dark"} onClick={() => setTheme("dark")}>
                {t("appSettings.themeDark")}
              </ChoiceButton>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
