import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  collectAncestorDirectories,
  resolveExplorerUploadDirectory,
  uploadDestinationLabel,
} = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./explorer-upload-target.ts");

test("resolveExplorerUploadDirectory prefers an explicit drop target", () => {
  assert.equal(
    resolveExplorerUploadDirectory({
      cwd: "/project",
      selectedPath: "/project/src",
      selectedIsDir: true,
      overridePath: "/project/docs",
    }),
    "/project/docs",
  );
});

test("resolveExplorerUploadDirectory uses the selected folder", () => {
  assert.equal(
    resolveExplorerUploadDirectory({
      cwd: "/project",
      selectedPath: "/project/src",
      selectedIsDir: true,
    }),
    "/project/src",
  );
});

test("resolveExplorerUploadDirectory uses the parent of a selected file", () => {
  assert.equal(
    resolveExplorerUploadDirectory({
      cwd: "/project",
      selectedPath: "/project/src/main.ts",
      selectedIsDir: false,
    }),
    "/project/src",
  );
});

test("resolveExplorerUploadDirectory falls back to cwd", () => {
  assert.equal(
    resolveExplorerUploadDirectory({
      cwd: "/project",
      selectedPath: null,
      selectedIsDir: false,
    }),
    "/project",
  );
});

test("uploadDestinationLabel shows a path relative to cwd", () => {
  assert.equal(uploadDestinationLabel("/project/src/lib", "/project"), "src/lib");
  assert.equal(uploadDestinationLabel("/project", "/project"), "project");
});

test("collectAncestorDirectories expands nested targets", () => {
  assert.deepEqual(
    collectAncestorDirectories("/project/src/lib", "/project"),
    ["/project/src", "/project/src/lib"],
  );
  assert.deepEqual(collectAncestorDirectories("/project", "/project"), []);
});
