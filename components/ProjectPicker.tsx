"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectoryPicker } from "./DirectoryPicker";
import { AnimatedDropdown, PathLabel, displayCwd } from "./path-ui";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface ProjectPickerProps {
  recentProjects: string[];
  selectedCwd: string | null;
  selectedProject: string | null;
  homeDir: string;
  onSelectCwd: (cwd: string) => void;
  /** "block" fills its container (sidebar empty state); "inline" is a compact toolbar trigger. */
  variant?: "block" | "inline";
  disabled?: boolean;
}

/**
 * Project/folder picker: a trigger button showing the current folder plus a
 * dropdown to switch to a recent project, browse for a custom path, or use
 * the default directory. Self-contained so it can render both as the sidebar's
 * initial "pick a project" entry point and inline in the chat composer once a
 * project is active.
 */
export function ProjectPicker({ recentProjects, selectedCwd, selectedProject, homeDir, onSelectCwd, variant = "block", disabled }: ProjectPickerProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setProjectFilter("");
    setCustomPathOpen(false);
    setCustomPathError(null);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen, closeDropdown]);

  const commitCustomPath = useCallback(async (candidate: string): Promise<boolean> => {
    const path = candidate.trim();
    if (!path || customPathValidating) return false;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      onSelectCwd(data.cwd ?? path);
      closeDropdown();
      return true;
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValidating, onSelectCwd, closeDropdown]);

  const handleCustomPathClick = useCallback(async () => {
    const desktop = window.piDesktop;
    if (!desktop) {
      // Web: open the browsable directory picker modal
      setCustomPathError(null);
      setCustomPathOpen(true);
      setDropdownOpen(false);
      return;
    }

    // Desktop: use the native directory selection dialog; fall back to the
    // browsable picker if the dialog fails or the chosen path is rejected.
    try {
      setCustomPathError(null);
      const path = await desktop.selectDirectory();
      if (path === null) return;
      const ok = await commitCustomPath(path);
      if (!ok) {
        setCustomPathOpen(true);
        setDropdownOpen(false);
      }
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
      setCustomPathOpen(true);
      setDropdownOpen(false);
    }
  }, [commitCustomPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        onSelectCwd(data.cwd);
        closeDropdown();
      }
    } catch {
      // ignore
    }
  }, [onSelectCwd, closeDropdown]);

  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  const isInline = variant === "inline";

  const panelStyle = isInline && dropdownRect
    ? {
        position: "fixed" as const,
        bottom: window.innerHeight - dropdownRect.top + 6,
        left: dropdownRect.left,
        width: "max-content",
        minWidth: Math.max(dropdownRect.width, 260),
        maxWidth: 360,
        zIndex: 650,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 -6px 20px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }
    : {
        position: "absolute" as const,
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 100,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
        overflow: "hidden",
      };

  return (
    <div ref={dropdownRef} style={{ position: "relative", width: isInline ? undefined : "100%" }}>
      <button
        type="button"
        className={isInline ? "native-toolbar-button" : "sidebar-project-button"}
        disabled={disabled}
        onClick={(e) => {
          if (isInline) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
          }
          setDropdownOpen((v) => !v);
        }}
        title={selectedProject ?? selectedCwd ?? ""}
        style={isInline ? {
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px",
          height: 32,
          maxWidth: 220,
          overflow: "hidden",
          background: dropdownOpen ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        } : {
          width: "100%",
          height: 32,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
          border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 12,
          color: "var(--text)",
          textAlign: "left",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        {isInline && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          </svg>
        )}
        {selectedCwd ? (
          <PathLabel
            text={displayCwd(selectedProject ?? selectedCwd, homeDir)}
            style={{
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontSize: isInline ? 12 : 11,
              color: isInline ? undefined : "var(--text)",
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            Select project…
          </span>
        )}
      </button>

      <AnimatedDropdown className="native-popover" open={dropdownOpen} style={panelStyle}>
        {showProjectFilter && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setProjectFilter("");
                  setDropdownOpen(false);
                }
              }}
              placeholder="Filter projects…"
              autoFocus
              style={{
                width: "100%",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                padding: "5px 8px",
                border: "1px solid var(--border)",
                borderRadius: 5,
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
          {visibleProjects.map((project) => (
            <button
              key={project}
              onClick={() => {
                onSelectCwd(project);
                closeDropdown();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "8px 10px",
                background: "var(--bg)",
                border: "none",
                borderBottom: "1px solid var(--border)",
                color: project === selectedProject ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={project}
            >
              {project === selectedProject && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="1.5 5 4 7.5 8.5 2.5" />
                </svg>
              )}
              {project !== selectedProject && <span style={{ width: 10, flexShrink: 0 }} />}
              <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
            </button>
          ))}
          {visibleProjects.length === 0 && projectFilter.trim() && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>No matching projects</div>
          )}
        </div>

        {/* Default cwd shortcut */}
        {!customPathOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleDefaultCwd(); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              width: "100%",
              padding: "8px 10px",
              background: "none",
              border: "none",
              borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 11,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
            </svg>
            <span>Use default directory</span>
          </button>
        )}

        {/* Custom path directory picker */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            void handleCustomPathClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            padding: "8px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: 11,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <line x1="5" y1="1" x2="5" y2="9" />
            <line x1="1" y1="5" x2="9" y2="5" />
          </svg>
          <span>Custom path…</span>
        </button>
      </AnimatedDropdown>

      {customPathOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
    </div>
  );
}
