import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertKylinBuildHost,
  stageKylinPackage,
} from "./kylin-package.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Runs dpkg-deb and surfaces its nonzero exit status.
 * @param {string} stageDir Complete Debian staging tree.
 * @param {string} outputPath Destination Debian archive.
 * @returns {Promise<void>} Promise resolved after successful package creation.
 */
async function buildDebianArchive(stageDir, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "dpkg-deb",
      ["--build", "--root-owner-group", stageDir, outputPath],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`dpkg-deb failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

assertKylinBuildHost(process.platform, process.arch);

const targetDir = join(rootDir, "src-tauri", "target", "kylin-arm64");
const stageDir = join(targetDir, "stage");
const outputDir = join(targetDir, "deb");
await mkdir(outputDir, { recursive: true });

const result = await stageKylinPackage({
  resourceRoot: join(rootDir, "src-tauri", "resources"),
  stageDir,
  launcherSource: join(rootDir, "desktop", "kylin-launcher.cjs"),
  iconSource: join(rootDir, "src-tauri", "icons", "128x128.png"),
  metadataSource: join(rootDir, "src-tauri", "pi-agent-desktop-package.json"),
});
const outputPath = join(outputDir, `Pi-Agent_${result.version}_kylin_arm64.deb`);
await buildDebianArchive(stageDir, outputPath);
console.log(`Kylin ARM64 Debian package created at ${outputPath}`);
