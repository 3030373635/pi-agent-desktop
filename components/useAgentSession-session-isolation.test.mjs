import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../hooks/useAgentSession.ts", import.meta.url);

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("context loads ignore stale sessions and out-of-order branch responses", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const body = functionSlice(source, "const loadContext = useCallback", "const loadTools = useCallback");
  assert.match(body, /requestId = \+\+contextLoadIdRef\.current/);
  assert.match(body, /sessionIdRef\.current === sid/);
  assert.match(body, /contextLoadIdRef\.current === requestId/);
  assert.match(body, /if \(!isCurrent\(\)\) return false/);
});

test("tool preset loads ignore stale sessions and out-of-order responses", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const body = functionSlice(source, "const loadTools = useCallback", "const promoteNewSession = useCallback");
  assert.match(body, /requestId = \+\+toolsLoadIdRef\.current/);
  assert.match(body, /sessionIdRef\.current === sid/);
  assert.match(body, /toolsLoadIdRef\.current === requestId/);
  assert.match(body, /tools && isCurrent\(\)/);
});

test("a stale branch load cannot navigate the newly active session", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const body = functionSlice(source, "const handleLeafChange = useCallback", "const handleModelChange = useCallback");
  assert.match(body, /const loaded = await loadContext\(sid, leafId\)/);
  assert.match(body, /loaded && leafId && sessionIdRef\.current === sid/);
});

test("returning to a session restores its last scroll position", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const positions = scrollPositionsRef\.current/);
  assert.match(source, /positions\.get\(sessionIdentity\)/);
  assert.match(source, /positions\.set\(sessionIdentity, container\.scrollTop\)/);
  assert.match(source, /container\.scrollTop = savedScrollTop/);
});
