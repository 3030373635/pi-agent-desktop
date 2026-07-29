import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createReadStream, existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";

/**
 * Incremental replacement for SessionManager.listAll().
 *
 * The SDK version stream-parses every .jsonl file on every call (and joins
 * all message text into an `allMessagesText` field this app never uses).
 * With hundreds of sessions that means re-reading every byte of every
 * session each time the list cache is invalidated — which happens after
 * every agent turn.
 *
 * This scanner produces the same per-file info (same field semantics as the
 * SDK's buildSessionInfo, minus allMessagesText) but caches it per file keyed
 * on mtime + size, so a refresh only re-parses files that actually changed.
 */
export interface ScannedSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

interface ScanCacheEntry {
  mtimeMs: number;
  size: number;
  info: ScannedSessionInfo | null;
}

declare global {
  var __piSessionScanCache: Map<string, ScanCacheEntry> | undefined;
}

function getScanCache(): Map<string, ScanCacheEntry> {
  if (!globalThis.__piSessionScanCache) globalThis.__piSessionScanCache = new Map();
  return globalThis.__piSessionScanCache;
}

/** Drop the cached parse for one file (e.g. after an in-place rewrite). */
export function invalidateScannedSession(filePath: string): void {
  getScanCache().delete(filePath);
}

function parseSessionEntryLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => (
      typeof block === "object" && block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ))
    .map((block) => block.text)
    .join(" ");
}

async function buildScannedSessionInfo(filePath: string): Promise<ScannedSessionInfo | null> {
  try {
    const stats = await stat(filePath);
    let header: Record<string, unknown> | null = null;
    let messageCount = 0;
    let firstMessage = "";
    let name: string | undefined;
    let lastActivityTime: number | undefined;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const entry = parseSessionEntryLine(line);
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
        name = rawName || undefined;
      }
      if (entry.type !== "message") continue;
      messageCount++;

      const message = entry.message as Record<string, unknown> | undefined;
      if (!message || typeof message.role !== "string" || !("content" in message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;

      const msgTimestamp = message.timestamp;
      const activityTime = typeof msgTimestamp === "number"
        ? msgTimestamp
        : typeof entry.timestamp === "string"
          ? new Date(entry.timestamp).getTime()
          : NaN;
      if (!Number.isNaN(activityTime)) {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }

      if (!firstMessage && message.role === "user") {
        firstMessage = extractTextContent(message.content);
      }
    }

    if (!header || typeof header.id !== "string") return null;
    const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
    const modified = typeof lastActivityTime === "number" && lastActivityTime > 0
      ? new Date(lastActivityTime)
      : !Number.isNaN(headerTime)
        ? new Date(headerTime)
        : stats.mtime;

    return {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      created: new Date(String(header.timestamp)),
      modified,
      messageCount,
      firstMessage: firstMessage || "(no messages)",
    };
  } catch {
    return null;
  }
}

const MAX_CONCURRENT_SCANS = 10;

export async function scanAllSessions(): Promise<ScannedSessionInfo[]> {
  const sessionsDir = join(getAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) return [];

  let files: string[];
  try {
    const dirEntries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = dirEntries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));
    const perDir = await Promise.all(dirs.map(async (dir) => {
      try {
        return (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
      } catch {
        return [];
      }
    }));
    files = perDir.flat();
  } catch {
    return [];
  }

  const cache = getScanCache();
  const liveFiles = new Set(files);
  for (const cachedPath of cache.keys()) {
    if (!liveFiles.has(cachedPath)) cache.delete(cachedPath);
  }

  const results: (ScannedSessionInfo | null)[] = new Array(files.length).fill(null);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      const filePath = files[index];
      try {
        const stats = await stat(filePath);
        const cached = cache.get(filePath);
        if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
          results[index] = cached.info;
          continue;
        }
        const info = await buildScannedSessionInfo(filePath);
        cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, info });
        results[index] = info;
      } catch {
        results[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SCANS, files.length) }, worker));

  const sessions = results.filter((info): info is ScannedSessionInfo => info !== null);
  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}
