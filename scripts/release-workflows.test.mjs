import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const componentUpdates = await readFile(
  join(root, ".github", "workflows", "component-updates.yml"),
  "utf8",
);

test("component updates run daily with the permissions the sync needs", () => {
  assert.match(componentUpdates, /cron: "17 2 \* \* \*"/);
  assert.match(componentUpdates, /actions: write/);
  assert.match(componentUpdates, /contents: write/);
  assert.match(componentUpdates, /pull-requests: write/);
  assert.match(componentUpdates, /issues: write/);
  assert.doesNotMatch(componentUpdates, /codex\/component-updates/);
});

test("the boundary is classified before the merge, not after", () => {
  // Once a merge commit exists the incoming changeset can no longer be
  // recovered with a plain diff, so ordering here is load-bearing.
  const classifyAt = componentUpdates.indexOf("fork-ownership.mjs classify");
  const mergeAt = componentUpdates.indexOf("git merge --no-edit --no-ff");
  assert.ok(classifyAt > -1, "sync must classify the upstream changeset");
  assert.ok(mergeAt > -1, "sync must still merge the upstream tag");
  assert.ok(classifyAt < mergeAt, "classification must run before the merge");
});

test("unattended publish is gated on the fork boundary", () => {
  // A clean merge into a fork-modified file can be a silent semantic conflict,
  // so only a no-overlap sync may reach a signed release without review.
  assert.match(
    componentUpdates,
    /steps\.boundary\.outputs\.review_required != 'true'[\s\S]{0,400}git push origin HEAD:main/,
  );
  const reviewStep = componentUpdates.slice(componentUpdates.indexOf("Open a review PR"));
  assert.match(reviewStep, /steps\.boundary\.outputs\.review_required == 'true'/);
  assert.match(reviewStep, /gh pr create/);
  assert.match(componentUpdates, /gh workflow run release\.yml .*--ref main/);
});

test("the release dispatch is unreachable from the review path", () => {
  // The PR path must not also fire the signed build; review has to mean review.
  const reviewStep = componentUpdates.slice(componentUpdates.indexOf("Open a review PR"));
  assert.doesNotMatch(reviewStep, /gh workflow run release\.yml/);
});

test("the merge gate covers tests, types, lint and a real build", () => {
  assert.match(componentUpdates, /npm test/);
  assert.match(componentUpdates, /tsc --noEmit/);
  assert.match(componentUpdates, /npm run lint/);
  assert.match(componentUpdates, /PI_WEB_DESKTOP_BUILD=1 node_modules\/\.bin\/next build/);
});

test("npm test covers every test directory, recursively", async () => {
  // Upstream ships components/*.test.mjs covering fork-modified files, and the
  // sync gate once ran only lib/ and scripts/, silently skipping them nightly.
  // The globs must recurse too: a flat components/*.test.mjs skips the
  // fork-owned tests under components/desktop/.
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const dir of ["lib", "scripts", "components"]) {
    assert.match(
      pkg.scripts.test,
      new RegExp(`${dir}/\\*\\*/\\*\\.test\\.mjs`),
      `npm test must recurse into ${dir}/`,
    );
  }
});

test("no test file is left out of npm test", async () => {
  // Catches a test added in a directory the globs do not cover.
  const { execFileSync } = await import("node:child_process");
  const tracked = execFileSync("git", ["ls-files", "*.test.mjs"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const covered = tracked.filter((file) => /^(lib|scripts|components)\//.test(file));
  assert.deepEqual(
    tracked.filter((file) => !covered.includes(file)),
    [],
    "a .test.mjs file lives outside lib/, scripts/ and components/ — extend npm test",
  );
});

test("a sync already awaiting review is skipped, not retried nightly", () => {
  // needs_update stays true while a review PR is open, so without this guard
  // the job would rebuild and collide with its own branch every night — and
  // file a failure issue each time.
  assert.match(componentUpdates, /gh pr list[\s\S]{0,160}--head "sync\/pi-web-\$PI_WEB_TAG"/);
  assert.match(componentUpdates, /awaiting_review=true/);

  const gated = componentUpdates
    .split("\n")
    .filter((line) => line.trimStart().startsWith("if: steps.releases.outputs.needs_update"));
  assert.ok(gated.length >= 3, "expected the sync/verify/publish steps to be gated");
  for (const line of gated) {
    assert.match(line, /steps\.pending\.outputs\.awaiting_review != 'true'/);
  }
});

test("a failed sync is reported instead of failing silently", () => {
  assert.match(componentUpdates, /if: failure\(\)/);
  assert.match(componentUpdates, /gh issue create/);
  assert.match(componentUpdates, /component-sync-failure/);
});

test("the pi package list is derived, never hand-written in the workflow", () => {
  assert.match(componentUpdates, /scripts\/pi-packages\.mjs --install-spec/);
  assert.doesNotMatch(componentUpdates, /@earendil-works\/pi-coding-agent@/);
  assert.doesNotMatch(componentUpdates, /@earendil-works\/pi-tui@/);
});

test("history is never rewritten on main", () => {
  // --force-with-lease on the disposable sync branch is fine; a bare --force
  // anywhere, or any force push to main, is not.
  assert.doesNotMatch(componentUpdates, /--force(?!-with-lease)/);
  assert.doesNotMatch(componentUpdates, /push .*--force-with-lease origin HEAD:main/);
});

test("release workflow publishes Apple Silicon and Windows x64 installers", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /runner: macos-15/);
  assert.match(workflow, /target: aarch64-apple-darwin/);
  assert.match(workflow, /runner: windows-latest/);
  assert.match(workflow, /target: x86_64-pc-windows-msvc/);
  assert.match(workflow, /--bundles nsis/);
  assert.doesNotMatch(workflow, /x86_64-apple-darwin/);
  assert.doesNotMatch(workflow, /macos-15-intel/);
  assert.match(workflow, /uploadUpdaterJson: true/);
  assert.match(workflow, /gh release edit "v\$version" --draft=false --latest/);
});
