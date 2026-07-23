import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("component updates use main directly and dispatch the release workflow", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "component-updates.yml"),
    "utf8",
  );

  assert.match(workflow, /cron: "17 2 \* \* \*"/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /gh workflow run release\.yml .*--ref main/);
  assert.doesNotMatch(workflow, /codex\/component-updates/);
  assert.doesNotMatch(workflow, /gh pr (?:create|edit)/);
  assert.doesNotMatch(workflow, /--force/);
});

test("release workflow supports explicit dispatch and publishes Apple Silicon only", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /targets: aarch64-apple-darwin/);
  assert.match(workflow, /args: --target aarch64-apple-darwin/);
  assert.doesNotMatch(workflow, /x86_64-apple-darwin/);
  assert.doesNotMatch(workflow, /macos-15-intel/);
  assert.match(workflow, /uploadUpdaterJson: true/);
  assert.match(workflow, /gh release edit "v\$version" --draft=false --latest/);
});
