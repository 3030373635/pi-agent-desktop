import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Pi delays the first flush of a new session until an assistant message
// exists, so the disk scan cannot see a run that just started. Everything here
// guards the seam that keeps such a session reachable mid-stream: without it
// the session the user is watching is absent from the sidebar (and opens
// empty) until the whole turn finishes.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("live snapshots skip sessions the disk scan already owns", async () => {
  const source = await read("./rpc-manager.ts");
  const listing = source.slice(
    source.indexOf("export function getLiveSessionSnapshots"),
    source.indexOf("export function getRunningRpcSessionIds"),
  );

  assert.match(listing, /knownSessionIds\.has\(session\.sessionId \|\| sessionId\)/);
  assert.match(listing, /!knownSessionIds\.has\(snapshot\.id\)/);
});

test("a session with no user message produces no row", async () => {
  const source = await read("./rpc-manager.ts");
  const snapshot = source.slice(
    source.indexOf("getLiveSnapshot()"),
    source.indexOf("setForceEmptySystemPrompt"),
  );

  // Without this an untouched "new chat" runtime renders a row that vanishes
  // again as soon as the runtime idles out.
  assert.match(snapshot, /if \(!firstMessage\) return null;/);
});

test("the session list merges live rows and keeps one row per id", async () => {
  const source = await read("../app/api/sessions/route.ts");

  assert.match(source, /getLiveSessionSnapshots\(new Set\(scanned\.map\(\(s\) => s\.id\)\)\)/);
  assert.match(source, /projectRoot: project\?\.projectRoot \?\? snapshot\.cwd/);
  assert.match(source, /\[\.\.\.live, \.\.\.scanned\]\.sort/);
});

test("reads fall back to the live session while its file is missing", async () => {
  const access = await read("./session-manager-access.ts");
  assert.match(access, /if \(existsSync\(filePath\)\) return SessionManager\.open\(filePath\)/);
  assert.match(access, /return live\.inner\.sessionManager/);

  // SessionManager.open() on a missing file returns an *empty* history rather
  // than throwing, so reading the file blindly silently shows an empty chat.
  for (const path of ["../app/api/sessions/[id]/route.ts", "../app/api/sessions/[id]/context/route.ts"]) {
    const source = await read(path);
    const getStart = source.indexOf("export async function GET");
    const nextExport = source.indexOf("export async function ", getStart + 1);
    const getSource = source.slice(getStart, nextExport === -1 ? undefined : nextExport);
    assert.match(getSource, /openSessionManagerForRead\(id, filePath\)/, path);
    assert.doesNotMatch(getSource, /SessionManager\.open\(filePath\)/, path);
  }
});

test("mutating an unflushed session goes through the runtime, not the file", async () => {
  const source = await read("../app/api/sessions/[id]/route.ts");
  const patchSource = source.slice(
    source.indexOf("export async function PATCH"),
    source.indexOf("export async function DELETE"),
  );
  const deleteSource = source.slice(source.indexOf("export async function DELETE"));

  const patchGuard = patchSource.indexOf("if (!existsSync(filePath))");
  assert.ok(patchGuard >= 0);
  assert.ok(patchGuard < patchSource.indexOf("SessionManager.open(filePath)"));
  assert.match(patchSource, /set_session_name/);

  const deleteGuard = deleteSource.indexOf("if (!existsSync(filePath))");
  assert.ok(deleteGuard >= 0);
  assert.ok(deleteGuard < deleteSource.indexOf("unlinkSync(filePath)"));
  assert.match(deleteSource, /live\.destroy\(\)/);
});

test("the sidebar refetches once for a running session it has no row for", async () => {
  const source = await read("../components/SessionSidebar.tsx");

  assert.match(source, /!known\.has\(id\) && !refetchedRunningIdsRef\.current\.has\(id\)/);
  assert.match(source, /missing\.forEach\(\(id\) => refetchedRunningIdsRef\.current\.add\(id\)\)/);
});
