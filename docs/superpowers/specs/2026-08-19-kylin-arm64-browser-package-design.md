# Kylin ARM64 Browser Package Design

## Background

The existing Linux ARM64 Debian package uses the Tauri 2 WebView shell. Tauri 2 links against WebKitGTK 4.1, while the target Kylin V10 SP1 ARM64 machine provides only `libwebkit2gtk-4.0-37`. The machine is also installed in an offline environment, so `apt` cannot fetch WebKitGTK 4.1 or the optional font packages currently declared by the Debian package.

The Kylin package therefore needs a separate shell that does not link against WebKitGTK. It must keep the existing application server, bundled Node.js runtime, Playwright CLI, and Playwright Chromium resources.

## Goals

- Produce a Kylin V10 SP1 compatible `arm64` Debian package in GitHub Actions.
- Install successfully without `libwebkit2gtk-4.1-0`, AppIndicator, or optional font packages.
- Start the packaged Next.js application on loopback and open it in the system default browser.
- Preserve the bundled Playwright CLI and Chromium revision for offline use.
- Keep the existing Tauri Linux ARM64 workflow and package unchanged.
- Provide deterministic status, stop, log, and Playwright command entry points for offline diagnosis.

## Non-goals

- Backport Tauri to WebKitGTK 4.0.
- Privately bundle WebKitGTK 4.1 and its transitive libraries.
- Recreate Tauri-only native dialogs, tray integration, notifications, or automatic updates in the browser shell.
- Guarantee that every Playwright Chromium shared-library dependency exists on every Kylin installation. The package will include the browser and provide a runtime smoke test, but it will not make optional Linux desktop libraries hard Debian dependencies.

## Package Architecture

The Kylin artifact is built independently of the Tauri bundler with `dpkg-deb`. It reuses the output of `scripts/prepare-desktop.mjs` and preserves its resource-relative layout:

```text
/opt/pi-agent/
  resources/
    node/
      node
      playwright-cli
    server/
      desktop-server.cjs
      server.js
      node_modules/
      .next-desktop/
      public/
    playwright-browsers/
    component-versions.json
  launcher/
    pi-agent-kylin.cjs

/usr/bin/pi-agent-desktop
/usr/bin/pi-agent-playwright
/usr/share/applications/pi-agent-desktop.desktop
/usr/share/icons/hicolor/128x128/apps/pi-agent-desktop.png
```

The Debian control file declares `Architecture: arm64` and the baseline runtime dependencies `libc6 (>= 2.28)`, `libstdc++6`, and `libgcc-s1` required by the bundled Node.js executable. Browser-opening helpers and Chromium desktop libraries remain runtime-detected so missing optional package names do not block offline installation.

## Launcher Process Model

`pi-agent-desktop` invokes the bundled Node.js runtime and `pi-agent-kylin.cjs`. The launcher supports these commands:

- `open` or no argument: reuse a healthy server or start one, then open its URL.
- `status`: report whether the recorded server instance is healthy and print its URL.
- `stop`: terminate the recorded supervisor and its packaged server.
- `logs`: print the server log path.

The initial `open` invocation starts a detached supervisor instance of the same launcher and waits for the server identity endpoint. The supervisor owns the Next.js child process and remains alive after the initial command exits. This makes desktop-icon startup non-blocking and keeps active agent sessions alive after a browser tab closes.

Runtime state lives below `${XDG_RUNTIME_DIR}/pi-agent/` when available, otherwise a user-specific directory below the operating system temporary directory. Logs live below `${XDG_STATE_HOME}/pi-agent/` when available, otherwise `~/.local/state/pi-agent/`.

The state record contains the supervisor PID, selected port, random instance identifier, and startup phase. Before spawning, `open` publishes a time-bounded `starting` reservation; the supervisor keeps that reservation until its identity endpoint responds, then may replace it with `running` state only when the instance identifier still matches. `open` waits on recent reservations and `status` reports them as starting without cleanup. All reads followed by a state mutation run under the same single-instance lock, including conditional cleanup, and cleanup compares the observed phase and process fields so it cannot delete a state record that transitioned meanwhile. This prevents a dying launcher or old supervisor from deleting a replacement supervisor's state. Every reuse or stop operation verifies both the PID and `GET /api/desktop/identity`; a stale state file is never treated as a running Pi Agent server.

The preferred port is `38471`. If occupied, the launcher probes the next 32 ports and finally asks the operating system for an available loopback port. The chosen origin remains stable while the supervisor is alive.

## Server Startup and Shutdown

The supervisor starts:

```text
/opt/pi-agent/resources/node/node
  /opt/pi-agent/resources/server/desktop-server.cjs
```

with these relevant environment values:

- `HOSTNAME=127.0.0.1`
- `PORT=<selected port>`
- `NODE_ENV=production`
- `NEXT_TELEMETRY_DISABLED=1`
- `PI_WEB_PARENT_PID=<supervisor pid>`
- `PI_DESKTOP_INSTANCE_ID=<random instance id>`
- `PATH=<bundled Node directory>:<login PATH>`

The existing `desktop-server.cjs` parent watchdog therefore terminates the server if the supervisor crashes. The supervisor forwards `SIGINT`, `SIGTERM`, and shutdown requests to the server process group, waits briefly, then escalates only if the process remains alive.

Startup succeeds only after `/api/desktop/identity` returns HTTP 204 with the expected instance header. Early process exit, timeout, or identity mismatch is reported with the server log location.

## Browser Opening

The launcher tries browser-opening commands in this order:

1. `xdg-open <url>`
2. `gio open <url>`

If neither command exists or both fail, the application server remains running and the launcher prints the loopback URL for manual opening. These helpers are not hard Debian dependencies.

Because this runs in a normal browser, `isTauriDesktop()` remains false. Existing web fallbacks continue to handle downloads and external links. Tauri-only native file pickers, reveal-in-folder actions, tray behavior, native completion notifications, and updater installation are unavailable by design.

## Security Model

- The server binds only to `127.0.0.1`; the Kylin launcher never enables LAN binding.
- The random instance identifier proves process ownership during health checks but does not authorize filesystem access.
- The launcher does not set or expose `PI_DESKTOP_API_TOKEN`, so the broad native-dialog filesystem endpoints continue to reject browser requests.
- Existing Host and Origin validation remains enabled for normal APIs.
- Runtime and state directories are created for the current user only, and state files are not trusted without a live identity probe.

## Playwright CLI

`pi-agent-playwright` delegates to the existing resource-relative launcher at `/opt/pi-agent/resources/node/playwright-cli`. That launcher sets:

- `PLAYWRIGHT_BROWSERS_PATH=/opt/pi-agent/resources/playwright-browsers`
- `PLAYWRIGHT_MCP_BROWSER=chromium`
- `PLAYWRIGHT_SKIP_BROWSER_GC=1`
- `NO_UPDATE_NOTIFIER=1`

The package therefore does not download browsers at runtime. The existing GitHub Actions Playwright smoke test remains, and the Kylin workflow additionally runs the staged command before package creation.

Kylin shared-library compatibility is validated after installation with an offline smoke command. If Chromium cannot launch, the diagnostic output identifies missing shared libraries without making those libraries package-installation blockers.

## Build Pipeline

A new `scripts/build-kylin-deb.mjs` command performs these steps:

1. Validate that the host, bundled Node runtime, and primary Playwright Chromium executable are Linux ELF64 ARM64.
2. Read the application version and package metadata.
3. Create an isolated Debian staging directory.
4. Copy prepared resources without changing their relative layout.
5. Install launcher scripts, desktop entry, icon, copyright metadata, and Debian control files.
6. Normalize executable permissions, including the bundled Node and Chromium executables.
7. Run `dpkg-deb --build --root-owner-group`.
8. Print the final package path for CI artifact upload.

The new GitHub Actions workflow runs on `ubuntu-24.04-arm`, prepares the desktop resources, executes JavaScript/TypeScript checks, smoke-tests the bundled Playwright CLI, builds the Kylin package, inspects its architecture and dependency fields, extracts it into a temporary directory, verifies the Node and Chromium architecture and permissions, checks the bundled Node with `ldd` for unresolved libraries, and smoke-tests the launcher against that extracted layout.

## Error Handling and Diagnostics

- A missing bundled Node binary or server entry point fails immediately with the absolute missing path.
- An occupied preferred port triggers bounded fallback probing rather than terminating another process.
- A stale state record is removed only after PID and identity validation fail, while holding the launch lock and confirming the instance identifier still matches.
- Server stdout and stderr append to a per-user log file.
- Browser-opening failure prints the server URL and leaves the server available.
- `status` uses a nonzero exit code when no healthy instance exists.
- `stop` is idempotent and reports that the app is already stopped when appropriate.
- Package construction rejects non-ELF64 ARM64 Node or Chromium resources and missing required files before invoking `dpkg-deb`.

## Testing Strategy

All behavior-bearing JavaScript is implemented test-first with Node's built-in test runner.

- Launcher unit tests cover runtime paths and permissions, startup reservations, state validation, port selection, browser fallback, locked conditional cleanup, replacement-instance protection, and command parsing through injected filesystem, process, network, and opener boundaries.
- Package-builder tests cover Debian metadata, forbidden dependencies, file layout, architecture validation, and executable permissions.
- Workflow contract tests verify the Kylin workflow includes package inspection, extraction, server startup, and Playwright smoke steps.
- Existing `npm test`, TypeScript checking, linting, and Tauri workflow tests remain green.
- GitHub Actions performs the final Linux ARM64 package smoke test because the Apple ARM64 development machine cannot execute Linux ARM64 binaries natively.
- The Kylin acceptance test installs the package with `dpkg -i`, runs `pi-agent-desktop status/open/stop`, opens the UI in the system browser, and runs a minimal `pi-agent-playwright` browser session without network access.

## Acceptance Criteria

- `sudo dpkg -i Pi-Agent_<version>_kylin_arm64.deb` completes on the target Kylin V10 SP1 ARM64 machine without asking for WebKitGTK 4.1, AppIndicator, or optional fonts.
- The desktop entry and `pi-agent-desktop` open the local UI in the default browser.
- Repeated launches reuse one healthy server.
- `pi-agent-desktop status`, `logs`, and `stop` behave deterministically.
- `pi-agent-playwright` resolves only bundled Node, CLI, and browser resources.
- The application works without outbound network access after installation, except for user-configured model providers that naturally require reachable endpoints.
- Existing Tauri ARM64 artifacts continue to build through their current workflow.
