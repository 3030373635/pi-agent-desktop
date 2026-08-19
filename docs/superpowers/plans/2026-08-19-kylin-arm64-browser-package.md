# Kylin ARM64 Browser Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline-installable Kylin V10 SP1 ARM64 Debian package that runs Pi Agent through the system browser while retaining the bundled Playwright CLI and Chromium.

**Architecture:** Reuse the existing standalone Next.js, Node.js, Playwright CLI, and Chromium resources, but stage them with a new `dpkg-deb` builder instead of Tauri. A testable CommonJS launcher supervises the packaged server on loopback, persists per-user runtime state, opens the default browser, and exposes status/stop/log commands.

**Tech Stack:** Node.js 22 CommonJS/ES modules, Node built-in test runner, Debian `dpkg-deb`, GitHub Actions ARM64 runners, existing Next.js standalone desktop resources.

**Spec:** `docs/superpowers/specs/2026-08-19-kylin-arm64-browser-package-design.md`

## Global Constraints

- The target is Kylin V10 SP1 on `aarch64`, in an offline environment.
- The Kylin package must not depend on WebKitGTK 4.1, AppIndicator, or optional font packages.
- The existing Tauri ARM64 package and workflow remain unchanged.
- The packaged server listens only on `127.0.0.1`.
- The package includes Node, Playwright CLI, and Playwright Chromium and performs no browser download at runtime.
- Tauri-only native filesystem APIs remain unauthorized in the browser shell.
- Every new function must include a comment describing its purpose and parameters; security- and process-critical lines require comments.
- Implementation follows test-driven development: every production behavior is preceded by a failing test that fails for the expected reason.
- Do not execute `git commit`; after each task, record the suggested Chinese Conventional Commit message.

---

### Task 1: Kylin server supervisor and command launcher

**Files:**
- Create: `desktop/kylin-launcher.cjs`
- Create: `scripts/kylin-launcher.test.mjs`

**Interfaces:**
- Consumes: packaged resource layout rooted at the parent of `desktop/kylin-launcher.cjs`; existing `resources/server/desktop-server.cjs`; environment variables `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `HOME`, and `PATH`.
- Produces: `createKylinLauncher(dependencies)` for unit tests and `runKylinLauncher(argv, environment)` for the command-line entry point.
- Commands: `open`, `status`, `stop`, `logs`, and internal `serve`.
- Runtime state shape: `{ supervisorPid: number, port: number, instanceId: string, phase: "starting" | "running", startedAt?: number }`.

- [ ] **Step 1: Write failing path and command-parsing tests**

Create `scripts/kylin-launcher.test.mjs` using `createRequire()` to load the CommonJS module. Start with tests that describe the public API before the production file exists:

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createKylinLauncher } = require("../desktop/kylin-launcher.cjs");

test("uses XDG directories and produces user-private Pi Agent paths", () => {
  const launcher = createKylinLauncher({
    environment: {
      XDG_RUNTIME_DIR: "/run/user/1000",
      XDG_STATE_HOME: "/home/user/.state",
      HOME: "/home/user",
    },
    uid: () => 1000,
  });

  assert.deepEqual(launcher.paths(), {
    runtimeDir: "/run/user/1000/pi-agent",
    statePath: "/run/user/1000/pi-agent/server.json",
    lockPath: "/run/user/1000/pi-agent/launch.lock",
    logPath: "/home/user/.state/pi-agent/server.log",
  });
});

test("rejects unknown commands without starting a server", async () => {
  const calls = [];
  const launcher = createKylinLauncher({ printError: (value) => calls.push(value) });

  assert.equal(await launcher.run(["unknown"]), 2);
  assert.match(calls.join("\n"), /open\|status\|stop\|logs/);
});
```

- [ ] **Step 2: Run the launcher test and verify RED**

Run:

```bash
node --test scripts/kylin-launcher.test.mjs
```

Expected: FAIL with `Cannot find module '../desktop/kylin-launcher.cjs'`.

- [ ] **Step 3: Implement path resolution and command dispatch minimally**

Create `desktop/kylin-launcher.cjs` with `require.main === module` protection. Export the factory and CLI function so tests never need to spawn the real server:

```js
"use strict";

/**
 * Creates a Kylin launcher with injectable operating-system boundaries.
 * @param {object} dependencies Filesystem, process, network, and output dependencies.
 * @returns {object} Command runner and testable launcher operations.
 */
function createKylinLauncher(dependencies = {}) {
  // Resolve XDG paths without trusting state owned by another user.
  function paths() {
    const runtimeBase = environment.XDG_RUNTIME_DIR
      || join(tmpdir(), `pi-agent-${uid()}`);
    const stateBase = environment.XDG_STATE_HOME
      || join(environment.HOME, ".local", "state");
    const runtimeDir = join(runtimeBase, "pi-agent");
    return {
      runtimeDir,
      statePath: join(runtimeDir, "server.json"),
      lockPath: join(runtimeDir, "launch.lock"),
      logPath: join(stateBase, "pi-agent", "server.log"),
    };
  }

  /**
   * Executes a public launcher command.
   * @param {string[]} argv Command arguments excluding Node and script paths.
   * @returns {Promise<number>} Process exit code.
   */
  async function run(argv) {
    const command = argv[0] ?? "open";
    // Dispatch only the documented command set.
  }

  return { paths, run };
}

async function runKylinLauncher(argv = process.argv.slice(2), environment = process.env) {
  return createKylinLauncher({ environment }).run(argv);
}

module.exports = { createKylinLauncher, runKylinLauncher };
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test scripts/kylin-launcher.test.mjs`

Expected: path and invalid-command tests PASS.

- [ ] **Step 5: Add failing server lifecycle tests**

Add real-behavior tests using injected boundaries for:

```js
test("open reuses a state record only when PID and identity both match", async () => {
  const events = [];
  const launcher = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "instance-a" }),
    processExists: () => true,
    probeIdentity: async () => true,
    spawnSupervisor: () => assert.fail("healthy state must be reused"),
    openCommand: async (command, args) => events.push([command, args]),
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(events, [["xdg-open", ["http://127.0.0.1:38471"]]]);
});

test("open removes stale state and starts one detached supervisor", async () => {
  const events = [];
  let reads = 0;
  const launcher = createKylinLauncher({
    readState: async () => reads++ === 0
      ? { supervisorPid: 41, port: 38471, instanceId: "stale" }
      : { supervisorPid: 43, port: 38472, instanceId: "fresh" },
    processExists: (pid) => pid === 43,
    probeIdentity: async (state) => state.instanceId === "fresh",
    removeState: async () => events.push("remove"),
    spawnSupervisor: () => events.push("spawn"),
    openCommand: async (command, args) => events.push([command, args]),
    wait: async () => {},
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(events, [
    "remove",
    "spawn",
    ["xdg-open", ["http://127.0.0.1:38472"]],
  ]);
});

test("browser fallback tries xdg-open before gio and prints the URL when both fail", async () => {
  const commands = [];
  const output = [];
  const launcher = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "instance-a" }),
    processExists: () => true,
    probeIdentity: async () => true,
    openCommand: async (command) => {
      commands.push(command);
      throw new Error(`${command} unavailable`);
    },
    print: (value) => output.push(value),
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(commands, ["xdg-open", "gio"]);
  assert.match(output.join("\n"), /http:\/\/127\.0\.0\.1:38471/);
});

test("status returns nonzero unless PID and server identity are healthy", async () => {
  const stale = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "stale" }),
    processExists: () => true,
    probeIdentity: async () => false,
  });
  const healthy = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "fresh" }),
    processExists: () => true,
    probeIdentity: async () => true,
  });

  assert.equal(await stale.run(["status"]), 1);
  assert.equal(await healthy.run(["status"]), 0);
});

test("stop is idempotent and signals only the verified supervisor", async () => {
  const signals = [];
  const launcher = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "fresh" }),
    processExists: () => true,
    probeIdentity: async () => true,
    signalProcess: (pid, signal) => signals.push([pid, signal]),
    wait: async () => {},
  });

  assert.equal(await launcher.run(["stop"]), 0);
  assert.deepEqual(signals, [[42, "SIGTERM"]]);
});

test("serve selects a loopback port and starts the existing desktop server", async () => {
  let serverOptions;
  const launcher = createKylinLauncher({
    choosePort: async () => 38473,
    randomId: () => "instance-c",
    processPid: 55,
    spawnServer: (options) => {
      serverOptions = options;
      return { wait: async () => 0, terminate: async () => {} };
    },
    writeState: async () => {},
    removeState: async () => {},
    acquireLock: async () => ({ release: async () => {} }),
  });

  assert.equal(await launcher.run(["serve"]), 0);
  assert.equal(serverOptions.environment.HOSTNAME, "127.0.0.1");
  assert.equal(serverOptions.environment.PORT, "38473");
  assert.equal(serverOptions.environment.PI_WEB_PARENT_PID, "55");
  assert.equal(serverOptions.environment.PI_DESKTOP_INSTANCE_ID, "instance-c");
  assert.match(serverOptions.scriptPath, /resources\/server\/desktop-server\.cjs$/);
});
```

The production change that makes these pass is the supervisor/state implementation; failures must be assertions about missing lifecycle calls, not test setup errors.

- [ ] **Step 6: Run lifecycle tests and verify RED**

Run: `node --test scripts/kylin-launcher.test.mjs`

Expected: FAIL because lifecycle methods are not implemented.

- [ ] **Step 7: Implement the minimal lifecycle**

Implement focused helpers inside the factory, each documented with parameters:

- `readState()` and `writeState(state)` with JSON validation, startup phases, and mode `0o600`.
- `probeIdentity(state)` using `GET /api/desktop/identity`, HTTP 204, and exact `x-pi-desktop-instance` comparison.
- `isHealthy(state)` requiring both a live PID and matching identity.
- `choosePort()` probing `38471..38503` on `127.0.0.1`, then port `0`.
- `openBrowser(url)` trying `xdg-open`, then `gio open`, then printing the URL.
- `startSupervisor()` publishing a `starting` reservation under the launch lock, spawning the bundled Node binary with the same launcher and `serve`, detached with ignored stdio, then polling the matching identity for at most 30 seconds.
- `serve()` creating user-private directories, spawning `desktop-server.cjs` in its own process group, waiting for its exact identity endpoint before claiming only its matching reservation under the launch lock, forwarding signals, and conditionally removing an unchanged owned state under the same lock on exit.
- `stop()` signaling only a state record that passes PID and identity verification.

Important implementation rules:

```js
const serverEnvironment = {
  ...environment,
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PI_WEB_PARENT_PID: String(processApi.pid),
  PI_DESKTOP_INSTANCE_ID: instanceId,
  // Put bundled Node first so Pi shell tools can resolve packaged executables.
  PATH: `${nodeDir}:${environment.PATH ?? ""}`,
};
```

Do not set `PI_DESKTOP_API_TOKEN`.

- [ ] **Step 8: Run focused and aggregate tests**

Run:

```bash
node --test scripts/kylin-launcher.test.mjs
npm test
```

Expected: all tests PASS with no leaked child processes.

- [ ] **Step 9: Record the task checkpoint**

Do not commit. Record suggested commit message: `feat: 新增麒麟浏览器模式启动器`.

---

### Task 2: Deterministic Kylin Debian package builder

**Files:**
- Create: `scripts/kylin-package.mjs`
- Create: `scripts/build-kylin-deb.mjs`
- Create: `scripts/kylin-package.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `src-tauri/resources/{server,node,playwright-browsers,component-versions.json}`, `src-tauri/icons/128x128.png`, `src-tauri/pi-agent-desktop-package.json`, and `desktop/kylin-launcher.cjs`.
- Produces: `createDebianControl(metadata)`, `validateArm64Elf(buffer)`, `stageKylinPackage(options)`, and a CLI-created `.deb` under `src-tauri/target/kylin-arm64/deb/`.
- npm command: `npm run kylin:build`, which runs desktop preparation and then the Debian builder.

- [ ] **Step 1: Write failing Debian metadata tests**

Create `scripts/kylin-package.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createDebianControl, validateArm64Elf } from "./kylin-package.mjs";

test("Kylin control metadata is arm64 without Tauri or optional font dependencies", () => {
  const control = createDebianControl({ version: "0.3.2", installedSize: 1234 });

  assert.match(control, /^Package: pi-agent$/m);
  assert.match(control, /^Version: 0\.3\.2$/m);
  assert.match(control, /^Architecture: arm64$/m);
  assert.match(control, /^Depends: libc6 \(>= 2\.28\), libstdc\+\+6, libgcc-s1$/m);
  assert.doesNotMatch(control, /webkit|appindicator|fonts-/i);
});

test("ELF validation accepts only little-endian AArch64 executables", () => {
  const arm64Elf = Buffer.alloc(64);
  arm64Elf.set([0x7f, 0x45, 0x4c, 0x46], 0);
  arm64Elf[5] = 1;
  arm64Elf.writeUInt16LE(183, 18);

  assert.doesNotThrow(() => validateArm64Elf(arm64Elf));
  arm64Elf.writeUInt16LE(62, 18);
  assert.throws(() => validateArm64Elf(arm64Elf), /AArch64/);
});
```

- [ ] **Step 2: Run package tests and verify RED**

Run: `node --test scripts/kylin-package.test.mjs`

Expected: FAIL with missing `scripts/kylin-package.mjs`.

- [ ] **Step 3: Implement metadata and ELF validation minimally**

Create `scripts/kylin-package.mjs` with documented exports. `createDebianControl()` must use the desktop version from `src-tauri/pi-agent-desktop-package.json`, use Debian package name `pi-agent`, and include:

```text
Package: pi-agent
Version: <desktop version>
Section: devel
Priority: optional
Architecture: arm64
Depends: libc6 (>= 2.28), libstdc++6, libgcc-s1
Installed-Size: <KiB>
Maintainer: pi-agent-desktop contributors
Description: Pi Agent browser shell for Kylin ARM64
 Offline desktop UI with bundled Node.js and Playwright CLI.
```

`validateArm64Elf(buffer)` checks ELF magic, ELF64 class, little-endian encoding, and `e_machine === 183`. Staging applies it to both the bundled Node executable and primary Playwright Chromium executable.

- [ ] **Step 4: Run metadata tests and verify GREEN**

Run: `node --test scripts/kylin-package.test.mjs`

Expected: metadata and ELF tests PASS.

- [ ] **Step 5: Add failing staging-layout tests**

Use `mkdtemp()` and small fixture resources. Assert that `stageKylinPackage()` creates:

```text
DEBIAN/control                         0644
opt/pi-agent/launcher/pi-agent-kylin.cjs 0755
opt/pi-agent/resources/node/node      0755
opt/pi-agent/resources/node/playwright-cli 0755
usr/bin/pi-agent-desktop              0755
usr/bin/pi-agent-playwright           0755
usr/share/applications/pi-agent-desktop.desktop 0644
usr/share/icons/hicolor/128x128/apps/pi-agent-desktop.png 0644
```

Also assert wrapper contents:

```sh
#!/bin/sh
exec /opt/pi-agent/resources/node/node /opt/pi-agent/launcher/pi-agent-kylin.cjs "$@"
```

and:

```sh
#!/bin/sh
exec /opt/pi-agent/resources/node/playwright-cli "$@"
```

The desktop entry must use `Exec=pi-agent-desktop open`, `Icon=pi-agent-desktop`, `Terminal=false`, and category `Development;`.

- [ ] **Step 6: Run staging tests and verify RED**

Run: `node --test scripts/kylin-package.test.mjs`

Expected: FAIL because `stageKylinPackage()` is absent.

- [ ] **Step 7: Implement staging and the thin build CLI**

Implement `stageKylinPackage(options)` with parameters for resource root, staging directory, launcher source, icon source, and metadata source. It must:

- reject missing required resource paths;
- validate the bundled Node ELF before copying bulk resources;
- use `fs.cp()` for resource trees;
- calculate installed size from staged regular files;
- write the control file only after size calculation;
- normalize directory, data file, and executable modes;
- preserve the exact `/opt/pi-agent/resources` relative layout.

Create `scripts/build-kylin-deb.mjs` as a thin executable that verifies `process.platform === "linux"` and `process.arch === "arm64"`, creates a clean staging directory under `src-tauri/target/kylin-arm64/`, invokes `stageKylinPackage()`, and runs:

```js
spawn("dpkg-deb", ["--build", "--root-owner-group", stageDir, outputPath], {
  stdio: "inherit",
});
```

The output filename is `Pi-Agent_<version>_kylin_arm64.deb`.

Add package scripts:

```json
{
  "kylin:package": "node scripts/build-kylin-deb.mjs",
  "kylin:build": "npm run desktop:prepare && npm run kylin:package"
}
```

- [ ] **Step 8: Run focused tests and repository checks**

Run:

```bash
node --test scripts/kylin-package.test.mjs scripts/kylin-launcher.test.mjs
npm test
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Expected: all commands PASS. Do not run `npm run kylin:build` on macOS because the builder must reject non-Linux hosts.

- [ ] **Step 9: Record the task checkpoint**

Do not commit. Record suggested commit message: `feat: 新增麒麟 ARM64 Debian 组包器`.

---

### Task 3: Native ARM64 GitHub Actions validation

**Files:**
- Create: `.github/workflows/kylin-arm64-build.yml`
- Modify: `scripts/release-workflows.test.mjs`

**Interfaces:**
- Consumes: `npm run desktop:prepare`, `npm run kylin:package`, and package output under `src-tauri/target/kylin-arm64/deb/`.
- Produces: GitHub Actions artifact `pi-agent-kylin-arm64` containing `Pi-Agent_*_kylin_arm64.deb`.

- [ ] **Step 1: Add a failing workflow contract test**

Append a test to `scripts/release-workflows.test.mjs` that requires:

```js
test("Kylin ARM64 builds a browser-shell deb without WebKitGTK", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "kylin-arm64-build.yml"),
    "utf8",
  );

  assert.match(workflow, /runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow, /npm run desktop:prepare/);
  assert.match(workflow, /npm run kylin:package/);
  assert.match(workflow, /dpkg-deb --field.*Architecture/);
  assert.match(workflow, /dpkg-deb --field.*Depends/);
  assert.match(workflow, /dpkg-deb --extract/);
  assert.match(workflow, /pi-agent-playwright|playwright-cli/);
  assert.match(workflow, /pi-agent-kylin\.cjs.*status/);
  assert.match(workflow, /pi-agent-kylin\.cjs.*stop/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /webkit|appindicator|fonts-/i);
});
```

- [ ] **Step 2: Run the workflow test and verify RED**

Run:

```bash
node --test scripts/release-workflows.test.mjs
```

Expected: FAIL with missing `.github/workflows/kylin-arm64-build.yml`.

- [ ] **Step 3: Implement the manual workflow**

Create `.github/workflows/kylin-arm64-build.yml` with `workflow_dispatch`, `contents: read`, and `runs-on: ubuntu-24.04-arm`. Steps:

1. Check out source.
2. Set up Node.js 22 with npm cache.
3. `npm ci`.
4. Install Playwright Chromium runtime libraries only for CI smoke testing with `playwright install-deps chromium`; do not copy those packages into Debian control metadata.
5. `npm run desktop:prepare`.
6. Run `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint`.
7. Run the packaged Playwright `open`, `snapshot`, and `close` smoke sequence.
8. Run `npm run kylin:package`.
9. Assert package architecture is `arm64` and dependency field equals `libc6 (>= 2.28), libstdc++6, libgcc-s1`.
10. Extract the package to a temporary directory; verify Node and Chromium are executable ELF64 ARM64 files and run `ldd` on Node with no unresolved libraries.
11. Start the extracted launcher with isolated `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, and `HOME`; verify `status`; verify the identity endpoint; run `stop`; verify state cleanup.
12. Invoke the extracted Playwright wrapper target directly against `about:blank` so no network is required.
13. Upload the `.deb` as artifact `pi-agent-kylin-arm64`.

The extracted smoke must call the extracted bundled Node and launcher paths, not `/usr/bin`, because the package is not installed into the CI host root.

- [ ] **Step 4: Run workflow contract and aggregate tests**

Run:

```bash
node --test scripts/release-workflows.test.mjs
npm test
git diff --check
```

Expected: all tests PASS.

- [ ] **Step 5: Record the task checkpoint**

Do not commit. Record suggested commit message: `ci: 新增麒麟 ARM64 离线包构建验证`.

---

### Task 4: Offline operator guide and final verification

**Files:**
- Create: `docs/kylin-arm64-offline-install.md`
- Modify: `README.md`
- Modify: `scripts/release-workflows.test.mjs` only if the documented workflow name needs a contract assertion.

**Interfaces:**
- Consumes: artifact name, package filename, and commands defined in Tasks 1–3.
- Produces: exact instructions for building, transferring, installing, validating, diagnosing, and uninstalling the offline package.

- [ ] **Step 1: Write the offline guide with exact commands**

Document:

```bash
sudo dpkg -i Pi-Agent_0.3.2_kylin_arm64.deb
pi-agent-desktop open
pi-agent-desktop status
pi-agent-desktop logs
pi-agent-playwright open about:blank
pi-agent-playwright snapshot
pi-agent-playwright close
pi-agent-desktop stop
sudo dpkg -r pi-agent
```

Also document:

- download the `pi-agent-kylin-arm64` artifact from the manual GitHub Actions workflow on an internet-connected machine;
- transfer the `.deb` by approved removable media;
- no `apt update` or runtime browser download is expected;
- normal browser mode lacks Tauri native dialogs, tray, native notifications, and auto-update;
- server log and `ldd` diagnostic commands for missing Chromium shared libraries;
- model-provider traffic still requires a reachable internal or external provider endpoint.

Add a concise Kylin link and compatibility note to `README.md`.

- [ ] **Step 2: Verify docs match production names**

Run:

```bash
rg -n "pi-agent-kylin-arm64|Pi-Agent_.*_kylin_arm64\.deb|pi-agent-desktop (open|status|logs|stop)|pi-agent-playwright" README.md docs/kylin-arm64-offline-install.md .github/workflows/kylin-arm64-build.yml scripts desktop
```

Expected: names and command paths are consistent; there are no old WebKit-based installation instructions in the Kylin guide.

- [ ] **Step 3: Run complete local verification**

Run:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
git status --short
```

Expected: tests, TypeScript, lint, and whitespace checks PASS. Status lists only intended Kylin package changes plus the approved design and plan documents.

- [ ] **Step 4: Trigger and inspect native ARM64 CI**

After the user pushes the branch, manually run `Build Kylin ARM64 offline package`. Verify:

- all tests and smoke checks pass;
- `dpkg-deb --field` reports `Architecture: arm64`;
- `Depends` equals `libc6 (>= 2.28), libstdc++6, libgcc-s1` and contains no WebKitGTK, AppIndicator, or font packages;
- artifact `pi-agent-kylin-arm64` contains the expected `.deb`;
- extracted launcher and Playwright smoke checks pass.

If CI fails, reproduce the failure with a test before changing production code.

- [ ] **Step 5: Perform Kylin offline acceptance**

On the target Kylin machine, install and run the guide commands. Capture:

```bash
dpkg -s pi-agent | grep -E '^(Status|Architecture|Depends):'
pi-agent-desktop status
pi-agent-playwright open about:blank
pi-agent-playwright snapshot
pi-agent-playwright close
```

Acceptance requires successful installation without WebKitGTK 4.1 or font dependency errors, a working local UI, and a working Playwright browser session. If only Chromium fails, collect:

```bash
find /opt/pi-agent/resources/playwright-browsers -type f -name chrome -exec ldd {} \;
```

and transfer only the reported Kylin ARM64 shared-library packages through the approved offline process.

- [ ] **Step 6: Record the final checkpoint**

Do not commit. Suggested final commit message: `feat: 支持银河麒麟 ARM64 离线浏览器安装包`.
