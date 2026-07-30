"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem } from "@/lib/types";

/** Leading decorative bullets some CLI extensions prepend (e.g. green ●). */
const LEADING_STATUS_MARKER_RE =
  /^(?:\x1B\[[0-9;]*m)*(?:[\u25CF\u25C9\u25CB\u25EF\u2022\u00B7\u25AA\u25AB\u2B24\u29BF\u2299\u2218\u2219\u{1F7E2}\u{1F534}\u{1F7E1}\u26AA\u26AB])(?:\x1B\[[0-9;]*m)*(?:\s+)?/u;

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim()
    .replace(LEADING_STATUS_MARKER_RE, "")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .filter(Boolean)
    .join(" ");
}

export function ExtensionStatusBar({ statuses }: { statuses: ExtensionStatusItem[] }) {
  if (statuses.length === 0) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  if (!statusLine) return null;
  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      role="status"
      aria-label={plainStatusLine}
      title={plainStatusLine}
      style={{
        display: "flex",
        alignItems: "center",
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: "min(42vw, 340px)",
        height: 32,
        padding: "0 6px",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {parseAnsiLine(statusLine).map((segment, index) => (
          <span key={index} style={segment.style}>{segment.text}</span>
        ))}
      </span>
    </div>
  );
}
