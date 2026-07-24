import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { desktopTargetTriple } from "./desktop-platform.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("desktop builds target Apple Silicon and Windows x64", () => {
  assert.equal(
    desktopTargetTriple("darwin", "arm64"),
    "aarch64-apple-darwin",
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
    () => desktopTargetTriple("linux", "x64"),
    /Unsupported desktop platform: linux\/x64/,
  );
});

test("Windows packaging includes Node, npm, an icon, and an NSIS installer", async () => {
  const [prepareSource, configSource] = await Promise.all([
    readFile(join(root, "scripts", "prepare-desktop.mjs"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"),
  ]);
  const config = JSON.parse(configSource);

  assert.match(prepareSource, /node\.exe/);
  assert.match(prepareSource, /node_modules", "npm"/);
  assert.deepEqual(config.bundle.targets, ["nsis"]);
  assert.ok(config.bundle.icon.includes("icons/icon.ico"));
  assert.ok(config.bundle.resources.includes("resources/node"));
});
