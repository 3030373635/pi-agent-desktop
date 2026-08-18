import { access, chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopTargetTriple } from "./desktop-platform.mjs";
import { piPackageDirNames } from "./pi-packages.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopBuildDir = join(rootDir, ".next-desktop");
const standaloneDir = join(desktopBuildDir, "standalone");
const serverResourcesDir = join(rootDir, "src-tauri", "resources", "server");
const serverHelperDir = join(rootDir, "src-tauri", "resources", "Pi Agent Server.app");
const nodeResourcesDir = join(rootDir, "src-tauri", "resources", "node");
const playwrightBrowsersDir = join(rootDir, "src-tauri", "resources", "playwright-browsers");
const playwrightPackageNames = ["@playwright/cli", "playwright", "playwright-core"];

async function runNextBuild() {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next", { paths: [rootDir] });

  await rm(desktopBuildDir, { recursive: true, force: true });

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
      cwd: rootDir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        PI_WEB_DESKTOP_BUILD: "1",
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Next.js desktop build failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function assembleServer() {
  await access(join(standaloneDir, "server.js"), constants.R_OK);
  await rm(serverResourcesDir, { recursive: true, force: true });
  await mkdir(dirname(serverResourcesDir), { recursive: true });
  await cp(standaloneDir, serverResourcesDir, { recursive: true });

  // Next's file tracer follows normal imports but intentionally omits files
  // reached through dynamic provider/export/plugin paths. These packages are
  // serverExternalPackages, so preserve their complete runtime `dist/` trees.
  for (const packageName of await piPackageDirNames()) {
    const source = join(rootDir, "node_modules", "@earendil-works", packageName, "dist");
    const destination = join(
      serverResourcesDir,
      "node_modules",
      "@earendil-works",
      packageName,
      "dist",
    );
    await cp(source, destination, { recursive: true, force: true });
  }

  await copyFile(
    join(rootDir, "desktop", "server-launcher.cjs"),
    join(serverResourcesDir, "desktop-server.cjs"),
  );

  const staticSource = join(desktopBuildDir, "static");
  const staticDestination = join(serverResourcesDir, ".next-desktop", "static");
  await mkdir(dirname(staticDestination), { recursive: true });
  await cp(staticSource, staticDestination, { recursive: true });

  const publicDir = join(rootDir, "public");
  try {
    await access(publicDir, constants.R_OK);
    await cp(publicDir, join(serverResourcesDir, "public"), { recursive: true });
  } catch {
    // `public/` is optional in Next.js projects.
  }
}

/**
 * Copies the Playwright CLI and its runtime packages into the packaged server.
 * The Next.js file tracer cannot discover packages invoked only through a shell command.
 */
async function assemblePlaywrightCli() {
  if (process.platform !== "linux") return;

  for (const packageName of playwrightPackageNames) {
    const source = join(rootDir, "node_modules", packageName);
    const destination = join(serverResourcesDir, "node_modules", packageName);
    await cp(source, destination, { recursive: true, force: true });
  }
}

async function readPackageVersion(packageDir) {
  try {
    return JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Package directories directly under a node_modules dir, resolving @scope/name. */
async function listPackageDirs(nodeModulesDir) {
  const packages = [];
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory()) {
          packages.push({ name: `${entry.name}/${scoped.name}`, dir: join(entryPath, scoped.name) });
        }
      }
      continue;
    }
    packages.push({ name: entry.name, dir: entryPath });
  }
  return packages;
}

/**
 * Drop nested node_modules copies that duplicate a top-level package at the
 * exact same version.
 *
 * npm nests a dependency when versions conflict, but it also leaves redundant
 * copies behind. Each nesting level adds ~45 characters to every path inside
 * it, and NSIS cannot open a path over Windows' 260-character MAX_PATH — one
 * file in @mistralai took the whole Windows installer down that way.
 *
 * Only exact version matches are removed, so a genuine version conflict keeps
 * its nested copy and Node still resolves it correctly.
 */
async function dedupeNestedPackages() {
  const topLevelDir = join(serverResourcesDir, "node_modules");
  const topLevelVersions = new Map();
  for (const { name, dir } of await listPackageDirs(topLevelDir)) {
    topLevelVersions.set(name, await readPackageVersion(dir));
  }

  let removed = 0;
  for (const { dir } of await listPackageDirs(topLevelDir)) {
    const nestedDir = join(dir, "node_modules");
    for (const nested of await listPackageDirs(nestedDir)) {
      const topVersion = topLevelVersions.get(nested.name);
      if (!topVersion) continue;
      if (topVersion !== (await readPackageVersion(nested.dir))) continue;

      await rm(nested.dir, { recursive: true, force: true });
      removed += 1;
    }

    // Removing @scope/name leaves the @scope directory behind. An empty
    // directory is harmless to Node but confuses anyone auditing the bundle.
    for (const entry of await readdir(nestedDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith("@")) continue;
      const scopeDir = join(nestedDir, entry.name);
      if ((await readdir(scopeDir)).length === 0) await rm(scopeDir, { recursive: true, force: true });
    }
  }
  return removed;
}

/** Paths that would exceed Windows' MAX_PATH once staged on a runner. */
async function findOverlongPaths() {
  // Mirrors the checkout location on a windows-latest runner. Measured even on
  // macOS so a long path fails the build here instead of inside makensis.
  const windowsPrefix = "D:\\a\\pi-agent-desktop\\pi-agent-desktop\\src-tauri\\resources\\server";
  const overlong = [];

  async function walk(dir, relative) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), childRelative);
        continue;
      }
      const full = `${windowsPrefix}\\${childRelative}`;
      if (full.length > 260) overlong.push({ length: full.length, path: childRelative });
    }
  }

  await walk(serverResourcesDir, "");
  return overlong;
}

async function findNpmSource() {
  const npmFromCurrentRun = process.env.npm_execpath
    ? dirname(dirname(process.env.npm_execpath))
    : null;
  const candidates = [
    npmFromCurrentRun,
    join(dirname(process.execPath), "node_modules", "npm"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(join(candidate, "bin", "npx-cli.js"), constants.R_OK);
      return candidate;
    } catch {
      // Try the next Node installation layout.
    }
  }

  throw new Error("Could not locate npm next to the bundled Node.js runtime.");
}

async function bundleNodeRuntime() {
  const triple = desktopTargetTriple();
  await rm(serverHelperDir, { recursive: true, force: true });
  await rm(nodeResourcesDir, { recursive: true, force: true });

  let binaryPath;
  if (process.platform === "darwin") {
    // Wrap Node in an LSBackgroundOnly .app so it does not appear in the Dock.
    // Info.plist uses the parent CFBundleIdentifier (com.abcwyc.pi-agent) so
    // macOS TCC SystemPolicyAppData grants persist across launches — a distinct
    // helper id re-prompts "access data from other apps" every cold start.
    const contentsDir = join(serverHelperDir, "Contents");
    binaryPath = join(contentsDir, "MacOS", "node");
    await mkdir(dirname(binaryPath), { recursive: true });
    await copyFile(process.execPath, binaryPath);
    await chmod(binaryPath, 0o755);
    await copyFile(
      join(rootDir, "desktop", "server-helper-Info.plist"),
      join(contentsDir, "Info.plist"),
    );
  } else {
    const executableName = process.platform === "win32" ? "node.exe" : "node";
    binaryPath = join(nodeResourcesDir, executableName);
    await mkdir(nodeResourcesDir, { recursive: true });
    await copyFile(process.execPath, binaryPath);
    await chmod(binaryPath, 0o755);
    await cp(
      await findNpmSource(),
      join(nodeResourcesDir, "node_modules", "npm"),
      { recursive: true },
    );
  }

  return { binaryPath, triple };
}

/**
 * Downloads the Chromium revision required by the pinned Playwright package.
 * PLAYWRIGHT_BROWSERS_PATH keeps architecture-specific browser files inside Tauri resources.
 */
async function bundlePlaywrightBrowser() {
  if (process.platform !== "linux") return null;

  await rm(playwrightBrowsersDir, { recursive: true, force: true });
  await mkdir(playwrightBrowsersDir, { recursive: true });

  const playwrightCli = join(rootDir, "node_modules", "playwright", "cli.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, "install", "chromium"], {
      cwd: rootDir,
      env: {
        ...process.env,
        CI: "1",
        PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersDir,
        PLAYWRIGHT_SKIP_BROWSER_GC: "1",
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Playwright browser install failed (${signal ?? `exit ${code}`}).`));
    });
  });

  return playwrightBrowsersDir;
}

/**
 * Creates the Linux launcher exposed to Pi's shell through the bundled Node directory.
 * The launcher resolves every path relative to itself so Debian installation prefixes are safe.
 */
async function writePlaywrightLauncher() {
  if (process.platform !== "linux") return null;

  const launcherPath = join(nodeResourcesDir, "playwright-cli");
  const launcher = `#!/bin/sh
set -eu

PLAYWRIGHT_NODE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLAYWRIGHT_RESOURCE_DIR="$(dirname -- "$PLAYWRIGHT_NODE_DIR")"

export NO_UPDATE_NOTIFIER=1
export PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_RESOURCE_DIR/playwright-browsers"
export PLAYWRIGHT_MCP_BROWSER=chromium
export PLAYWRIGHT_SKIP_BROWSER_GC=1

exec "$PLAYWRIGHT_NODE_DIR/node" \\
  "$PLAYWRIGHT_RESOURCE_DIR/server/node_modules/@playwright/cli/playwright-cli.js" \\
  "$@"
`;

  await writeFile(launcherPath, launcher, { mode: 0o755 });
  await chmod(launcherPath, 0o755);
  return launcherPath;
}

await runNextBuild();
await assembleServer();
await assemblePlaywrightCli();

const deduped = await dedupeNestedPackages();
if (deduped > 0) console.log(`Removed ${deduped} redundant nested package cop${deduped === 1 ? "y" : "ies"}`);

// Fail here rather than inside makensis, which reports a bare "failed opening
// file" and takes an entire signed release build down with it.
const overlong = await findOverlongPaths();
if (overlong.length > 0) {
  console.error(
    `${overlong.length} staged path(s) exceed Windows' 260-character limit:\n` +
      overlong.map(({ length, path }) => `  ${length}  ${path}`).join("\n"),
  );
  throw new Error("Staged paths would break the Windows installer.");
}

const { binaryPath: nodeBinary, triple } = await bundleNodeRuntime();
const playwrightBrowsers = await bundlePlaywrightBrowser();
const playwrightLauncher = await writePlaywrightLauncher();

console.log(`Desktop server staged at ${serverResourcesDir}`);
console.log(`Node runtime staged at ${nodeBinary} (${triple})`);
if (playwrightBrowsers && playwrightLauncher) {
  console.log(`Playwright browsers staged at ${playwrightBrowsers}`);
  console.log(`Playwright CLI staged at ${playwrightLauncher}`);
}
