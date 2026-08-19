import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/**
 * Rejects package creation unless prepared resources are native Linux ARM64.
 * @param {NodeJS.Platform} platform Node.js host platform.
 * @param {string} architecture Node.js host architecture.
 * @returns {void}
 */
export function assertKylinBuildHost(platform, architecture) {
  if (platform !== "linux" || architecture !== "arm64") {
    throw new Error(
      `Kylin package build requires native Linux ARM64, received ${platform}/${architecture}.`,
    );
  }
}

/**
 * Builds Debian control metadata for the Kylin ARM64 browser-shell package.
 * @param {{ version: string, installedSize: number }} metadata Package version and size in KiB.
 * @returns {string} Complete Debian control document.
 */
export function createDebianControl({ version, installedSize }) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid Debian package version: ${version}`);
  }
  if (!Number.isInteger(installedSize) || installedSize < 0) {
    throw new Error(`Invalid installed size: ${installedSize}`);
  }

  return [
    "Package: pi-agent",
    `Version: ${version}`,
    "Section: devel",
    "Priority: optional",
    "Architecture: arm64",
    "Depends: libc6 (>= 2.28), libstdc++6, libgcc-s1",
    `Installed-Size: ${installedSize}`,
    "Maintainer: pi-agent-desktop contributors",
    "Description: Pi Agent browser shell for Kylin ARM64",
    " Offline desktop UI with bundled Node.js and Playwright CLI.",
    "",
  ].join("\n");
}

/**
 * Validates that an ELF header describes a little-endian AArch64 executable.
 * @param {Buffer} buffer Buffer containing at least the ELF header prefix.
 * @param {string} label Human-readable executable label used in errors.
 * @returns {void}
 */
export function validateArm64Elf(buffer, label = "Executable") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    throw new Error(`${label} does not contain a complete ELF header.`);
  }
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`${label} is not an ELF executable.`);
  }
  if (buffer[4] !== 2) {
    throw new Error(`${label} is not a 64-bit ELF executable.`);
  }
  if (buffer[5] !== 1) {
    throw new Error(`${label} must use little-endian ELF encoding.`);
  }
  if (buffer.readUInt16LE(18) !== 183) {
    throw new Error(`${label} is not an AArch64 executable.`);
  }
}

/**
 * Reads only the fixed-size ELF prefix needed for architecture validation.
 * @param {string} executablePath Absolute path to an ELF executable.
 * @returns {Promise<Buffer>} Buffer containing the first 64 bytes.
 */
async function readElfHeader(executablePath) {
  const handle = await open(executablePath, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Locates the primary Chromium executable in Playwright's versioned browser tree.
 * @param {string} browsersDirectory Root of bundled Playwright browser revisions.
 * @returns {Promise<string>} Absolute Chromium executable path.
 */
async function findChromiumExecutable(browsersDirectory) {
  const revisions = await readdir(browsersDirectory, { withFileTypes: true });
  for (const revision of revisions) {
    if (!revision.isDirectory() || !/^chromium-\d+/.test(revision.name)) continue;
    const candidate = join(browsersDirectory, revision.name, "chrome-linux", "chrome");
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // Try another installed Chromium revision.
    }
  }
  throw new Error(`Chromium executable is missing below ${browsersDirectory}`);
}

/**
 * Calculates Debian Installed-Size from regular files below a data directory.
 * @param {string} rootDirectory Staged Debian data root.
 * @returns {Promise<number>} Rounded-up size in KiB.
 */
async function calculateInstalledSize(rootDirectory) {
  let totalBytes = 0;

  /**
   * Adds regular-file sizes recursively while leaving symbolic links untouched.
   * @param {string} directory Directory currently being visited.
   * @returns {Promise<void>} Promise resolved after the directory is counted.
   */
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else {
        const metadata = await lstat(entryPath);
        if (metadata.isFile()) totalBytes += metadata.size;
      }
    }
  }

  await walk(rootDirectory);
  return Math.ceil(totalBytes / 1024);
}

/**
 * Writes a UTF-8 package file and applies its deterministic Unix mode.
 * @param {string} path Destination path.
 * @param {string} contents Complete file contents.
 * @param {number} mode Unix permission bits.
 * @returns {Promise<void>} Promise resolved after writing and chmod.
 */
async function writePackageFile(path, contents, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, contents, { mode });
  await chmod(path, mode);
}

/**
 * Stages the complete Kylin ARM64 Debian filesystem tree.
 * @param {object} options Resource, metadata, icon, launcher, and staging paths.
 * @returns {Promise<{ version: string, installedSize: number, stageDir: string }>} Staging result.
 */
export async function stageKylinPackage({
  resourceRoot,
  stageDir,
  launcherSource,
  iconSource,
  metadataSource,
}) {
  const requiredPaths = [
    join(resourceRoot, "node", "node"),
    join(resourceRoot, "node", "playwright-cli"),
    join(resourceRoot, "server", "desktop-server.cjs"),
    join(resourceRoot, "server", "server.js"),
    join(resourceRoot, "playwright-browsers"),
    join(resourceRoot, "component-versions.json"),
    launcherSource,
    iconSource,
    metadataSource,
  ];
  await Promise.all(requiredPaths.map((requiredPath) => access(requiredPath, constants.R_OK)));

  const nodeExecutable = join(resourceRoot, "node", "node");
  const chromiumExecutable = await findChromiumExecutable(
    join(resourceRoot, "playwright-browsers"),
  );
  // Reject accidentally prepared macOS or x64 resources before copying large browser trees.
  validateArm64Elf(await readElfHeader(nodeExecutable), "Bundled Node runtime");
  validateArm64Elf(await readElfHeader(chromiumExecutable), "Chromium executable");
  const metadata = JSON.parse(await readFile(metadataSource, "utf8"));
  if (typeof metadata.version !== "string") {
    throw new Error(`Desktop package version is missing from ${metadataSource}`);
  }

  await rm(stageDir, { recursive: true, force: true });
  const installRoot = join(stageDir, "opt", "pi-agent");
  const stagedResources = join(installRoot, "resources");
  await mkdir(join(stageDir, "DEBIAN"), { recursive: true, mode: 0o755 });
  await mkdir(installRoot, { recursive: true, mode: 0o755 });
  await cp(resourceRoot, stagedResources, { recursive: true, force: true });

  const stagedLauncher = join(installRoot, "launcher", "pi-agent-kylin.cjs");
  await mkdir(dirname(stagedLauncher), { recursive: true, mode: 0o755 });
  await cp(launcherSource, stagedLauncher, { force: true });

  const desktopWrapper = join(stageDir, "usr", "bin", "pi-agent-desktop");
  const playwrightWrapper = join(stageDir, "usr", "bin", "pi-agent-playwright");
  await writePackageFile(
    desktopWrapper,
    '#!/bin/sh\nexec /opt/pi-agent/resources/node/node /opt/pi-agent/launcher/pi-agent-kylin.cjs "$@"\n',
    0o755,
  );
  await writePackageFile(
    playwrightWrapper,
    '#!/bin/sh\nexec /opt/pi-agent/resources/node/playwright-cli "$@"\n',
    0o755,
  );

  const desktopEntry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Pi Agent",
    "Comment=Desktop UI for the pi coding agent",
    "Exec=pi-agent-desktop open",
    "Icon=pi-agent-desktop",
    "Terminal=false",
    "Categories=Development;",
    "",
  ].join("\n");
  await writePackageFile(
    join(stageDir, "usr", "share", "applications", "pi-agent-desktop.desktop"),
    desktopEntry,
    0o644,
  );

  const stagedIcon = join(
    stageDir,
    "usr",
    "share",
    "icons",
    "hicolor",
    "128x128",
    "apps",
    "pi-agent-desktop.png",
  );
  await mkdir(dirname(stagedIcon), { recursive: true, mode: 0o755 });
  await cp(iconSource, stagedIcon, { force: true });
  await chmod(stagedIcon, 0o644);
  await writePackageFile(
    join(stageDir, "usr", "share", "doc", "pi-agent", "copyright"),
    "Copyright: pi-agent-desktop contributors\nLicense: MIT\n",
    0o644,
  );

  const executablePaths = [
    stagedLauncher,
    join(stagedResources, "node", "node"),
    join(stagedResources, "node", "playwright-cli"),
    join(stagedResources, relative(resourceRoot, chromiumExecutable)),
  ];
  await Promise.all(executablePaths.map((executablePath) => chmod(executablePath, 0o755)));

  const installedSize = await calculateInstalledSize(join(stageDir, "opt"));
  const usrInstalledSize = await calculateInstalledSize(join(stageDir, "usr"));
  await writePackageFile(
    join(stageDir, "DEBIAN", "control"),
    createDebianControl({
      version: metadata.version,
      installedSize: installedSize + usrInstalledSize,
    }),
    0o644,
  );

  return {
    version: metadata.version,
    installedSize: installedSize + usrInstalledSize,
    stageDir,
  };
}
