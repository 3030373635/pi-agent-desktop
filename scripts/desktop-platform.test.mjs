import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import { desktopTargetTriple } from "./desktop-platform.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("desktop builds target Apple Silicon, Linux x64, Linux ARM64, and Windows x64", () => {
  assert.equal(
    desktopTargetTriple("darwin", "arm64"),
    "aarch64-apple-darwin",
  );
  assert.equal(
    desktopTargetTriple("linux", "x64"),
    "x86_64-unknown-linux-gnu",
  );
  assert.equal(
    desktopTargetTriple("linux", "arm64"),
    "aarch64-unknown-linux-gnu",
  );
  assert.equal(
    desktopTargetTriple("win32", "x64"),
    "x86_64-pc-windows-msvc",
  );
});

test("unsupported desktop platforms fail before packaging", () => {
  assert.throws(
    () => desktopTargetTriple("darwin", "x64"),
    /Unsupported desktop platform: darwin\/x64/,
  );
  assert.throws(
    () => desktopTargetTriple("linux", "arm"),
    /Unsupported desktop platform: linux\/arm/,
  );
});

test("Linux packaging includes the Playwright CLI, browser, and bundled Node runtime", async () => {
  const [packageSource, prepareSource, linuxConfigSource, windowsConfigSource] = await Promise.all([
    readFile(join(root, "package.json"), "utf8"),
    readFile(join(root, "scripts", "prepare-desktop.mjs"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.linux.conf.json"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const linuxConfig = JSON.parse(linuxConfigSource);
  const windowsConfig = JSON.parse(windowsConfigSource);

  assert.match(packageJson.dependencies["@playwright/cli"], /^\d+\.\d+\.\d+$/);
  assert.match(prepareSource, /process\.platform === "win32" \? "node\.exe" : "node"/);
  assert.match(prepareSource, /node_modules", "npm"/);
  assert.match(prepareSource, /@playwright\/cli/);
  assert.match(prepareSource, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(prepareSource, /playwright-cli/);
  assert.deepEqual(linuxConfig.bundle.targets, ["deb"]);
  assert.ok(linuxConfig.bundle.resources.includes("resources/node"));
  assert.ok(linuxConfig.bundle.resources.includes("resources/playwright-browsers"));
  assert.deepEqual(windowsConfig.bundle.targets, ["nsis"]);
  assert.ok(windowsConfig.bundle.icon.includes("icons/icon.ico"));
  assert.ok(windowsConfig.bundle.resources.includes("resources/node"));
});

test("lint ignores generated Playwright browser resources", async () => {
  const eslint = new ESLint({ cwd: root });
  const generatedBrowserScript = join(
    root,
    "src-tauri",
    "resources",
    "playwright-browsers",
    "chromium-test",
    "main.js",
  );

  assert.equal(
    await eslint.isPathIgnored(generatedBrowserScript),
    true,
    "downloaded Chromium files must not be treated as project source",
  );
});
