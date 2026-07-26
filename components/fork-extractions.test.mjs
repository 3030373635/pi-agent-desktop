/**
 * Sentinels for fork changes inside upstream-owned components.
 *
 * A `git merge` conflict from agegr/pi-web is the safe outcome: the sync job
 * fails and a human looks. These tests cover the unsafe outcome — a merge that
 * succeeds cleanly and is still wrong, in either direction:
 *
 *   RESURRECTION  Code the fork moved to another file reappears at its origin.
 *                 Git does not track cross-file moves, so an upstream edit to
 *                 the moved region merges straight back in and the app ends up
 *                 with two copies of the same behaviour.
 *
 *   EROSION       A fork change is dropped by the merge, silently reverting a
 *                 desktop feature to its upstream form.
 *
 * Neither shows up in tsc, eslint, or the upstream test suite. See
 * docs/ownership-boundaries.md; risk levels live in scripts/fork-ownership.json.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(rootDir, file), "utf8");

/** Source with import statements removed, so a re-import never reads as a definition. */
function withoutImports(source) {
  return source.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");
}

function definesSymbol(source, symbol) {
  const body = withoutImports(source);
  return new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${symbol}\\b`,
  ).test(body);
}

const EXTRACTIONS = [
  {
    name: "SessionSidebar project picker",
    origin: "components/SessionSidebar.tsx",
    // Roughly 500 lines were moved out of SessionSidebar into these files,
    // neither of which exists upstream. This is the highest-risk divergence in
    // the fork; see the manifest entry for components/SessionSidebar.tsx.
    movedTo: ["components/ProjectPicker.tsx", "components/path-ui.tsx"],
    movedDefinitions: ["getRecentProjects", "displayCwd", "PathLabel", "AnimatedDropdown"],
    // Project-picker internals that must live only in ProjectPicker now.
    absentFromOrigin: [
      "customPathOpen",
      "customPathValidating",
      "projectFilter",
      "/api/cwd/validate",
      "/api/default-cwd",
    ],
    requiredInOrigin: ["ProjectPicker"],
  },
  {
    name: "AppShell window chrome",
    origin: "components/AppShell.tsx",
    // Desktop-only UI belongs in components/desktop/, so upstream layout files
    // carry a mount point rather than Tauri calls and window state.
    movedTo: ["components/desktop/WindowControls.tsx", "components/desktop/useDesktopChrome.ts"],
    movedDefinitions: [],
    absentFromOrigin: [
      "minimizeWindow",
      "toggleMaximizeWindow",
      "closeWindow",
      "isWindowMaximized",
      "window-control-btn",
      "@/lib/desktop-window",
    ],
    requiredInOrigin: ["WindowControls", "useDesktopChrome"],
  },
];

const FORK_FEATURES = [
  {
    name: "AppShell desktop chrome",
    file: "components/AppShell.tsx",
    // The window buttons and platform detection live in components/desktop/ now;
    // what AppShell must keep is the mount point and the drag-region spread.
    markers: [
      "useDesktopChrome",
      "WindowControls",
      "dragRegionProps",
      "app-topbar--mac-inset",
      "AppSettings",
      "UpdateReminder",
      "PRODUCT_NAME",
    ],
  },
  {
    name: "FileViewer toolbar",
    file: "components/FileViewer.tsx",
    markers: ["FileViewerToolbar", "FileViewerStatus", "getFileIcon", "file-viewer-toolbar"],
  },
  {
    name: "TabBar chrome",
    file: "components/TabBar.tsx",
    markers: ["file-tab-bar", "file-tab-label", "file-tab-close"],
  },
  {
    name: "native theme layer",
    file: "app/layout.tsx",
    // Dropping this import silently reverts the entire restyle to upstream.
    markers: ["./native-theme.css", "PRODUCT_NAME"],
  },
];

for (const extraction of EXTRACTIONS) {
  test(`${extraction.name}: extracted code does not reappear at its origin`, async () => {
    const origin = await read(extraction.origin);

    for (const symbol of extraction.movedDefinitions) {
      assert.equal(
        definesSymbol(origin, symbol),
        false,
        `${extraction.origin} defines ${symbol} again — an upstream merge probably resurrected it. ` +
          `It belongs in ${extraction.movedTo.join(" or ")}; importing it is fine, redefining it is not.`,
      );
    }

    for (const marker of extraction.absentFromOrigin) {
      assert.ok(
        !origin.includes(marker),
        `${extraction.origin} contains "${marker}" again — project-picker logic moved to ` +
          `${extraction.movedTo[0]} and must not come back.`,
      );
    }
  });

  test(`${extraction.name}: the extraction targets still own the moved code`, async () => {
    const targets = await Promise.all(extraction.movedTo.map(read));

    for (const symbol of extraction.movedDefinitions) {
      assert.ok(
        targets.some((source) => definesSymbol(source, symbol)),
        `None of ${extraction.movedTo.join(", ")} defines ${symbol}.`,
      );
    }

    // Without this the origin-side check could pass simply because the code was
    // deleted everywhere rather than relocated.
    for (const marker of extraction.absentFromOrigin) {
      assert.ok(
        targets.some((source) => source.includes(marker)),
        `"${marker}" is absent from ${extraction.origin} but also from ` +
          `${extraction.movedTo.join(", ")} — it looks deleted, not moved.`,
      );
    }
  });

  test(`${extraction.name}: the origin still consumes the extraction`, async () => {
    const origin = await read(extraction.origin);

    for (const symbol of extraction.requiredInOrigin) {
      assert.ok(
        origin.includes(symbol),
        `${extraction.origin} no longer references ${symbol} — the merge may have reverted it ` +
          `to the upstream inline implementation.`,
      );
    }
  });
}

for (const feature of FORK_FEATURES) {
  test(`${feature.name}: fork changes survive upstream merges`, async () => {
    const source = await read(feature.file);

    for (const marker of feature.markers) {
      assert.ok(
        source.includes(marker),
        `${feature.file} lost "${marker}" — an upstream merge likely reverted this file toward ` +
          `its upstream form. Re-apply the fork change rather than deleting this assertion.`,
      );
    }
  });
}
