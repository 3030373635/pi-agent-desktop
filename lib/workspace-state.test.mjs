import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./workspace-state.ts");
}

test("URL session wins over persisted workspace", async () => {
  const { resolveInitialNavigation } = await loadSubject();
  assert.deepEqual(
    resolveInitialNavigation(
      new URLSearchParams({ session: "from-url" }),
      { sessionId: "from-prefs", cwd: "/tmp/p", fileTabs: [], activeFileTabId: null, rightPanelOpen: false },
    ),
    { requestedCwd: null, sessionId: "from-url" },
  );
});

test("falls back to persisted session when URL has no navigation", async () => {
  const { resolveInitialNavigation } = await loadSubject();
  assert.deepEqual(
    resolveInitialNavigation(
      new URLSearchParams(),
      { sessionId: "from-prefs", cwd: "/tmp/p", fileTabs: [], activeFileTabId: null, rightPanelOpen: false },
    ),
    { requestedCwd: null, sessionId: "from-prefs" },
  );
});

test("URL cwd suppresses persisted session restore", async () => {
  const { resolveInitialNavigation } = await loadSubject();
  assert.deepEqual(
    resolveInitialNavigation(
      new URLSearchParams({ cwd: "/work/project" }),
      { sessionId: "from-prefs", cwd: "/tmp/p", fileTabs: [], activeFileTabId: null, rightPanelOpen: false },
    ),
    { requestedCwd: "/work/project", sessionId: null },
  );
});

test("file tabs only restore for matching session or cwd", async () => {
  const { workspaceFileTabsMatchContext } = await loadSubject();
  const workspace = {
    sessionId: "s1",
    cwd: "/proj",
    fileTabs: [{ filePath: "/proj/a.ts", label: "a.ts" }],
    activeFileTabId: "file:/proj/a.ts",
    rightPanelOpen: true,
  };

  assert.equal(workspaceFileTabsMatchContext(workspace, "s1", "/other"), true);
  assert.equal(workspaceFileTabsMatchContext(workspace, "other", "/proj"), true);
  assert.equal(workspaceFileTabsMatchContext(workspace, "other", "/other"), false);
  assert.equal(workspaceFileTabsMatchContext({ ...workspace, fileTabs: [] }, "s1", "/proj"), false);
});
