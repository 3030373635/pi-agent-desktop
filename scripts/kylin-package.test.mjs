import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertKylinBuildHost,
  createDebianControl,
  stageKylinPackage,
  validateArm64Elf,
} from "./kylin-package.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("Kylin control metadata is arm64 without Tauri or optional font dependencies", () => {
  const control = createDebianControl({ version: "0.3.2", installedSize: 1234 });

  assert.match(control, /^Package: pi-agent$/m);
  assert.match(control, /^Version: 0\.3\.2$/m);
  assert.match(control, /^Architecture: arm64$/m);
  assert.match(control, /^Depends: libc6 \(>= 2\.28\), libstdc\+\+6, libgcc-s1$/m);
  assert.match(control, /^Installed-Size: 1234$/m);
  assert.doesNotMatch(control, /webkit|appindicator|fonts-/i);
});

test("ELF validation accepts only little-endian AArch64 executables", () => {
  const arm64Elf = Buffer.alloc(64);
  arm64Elf.set([0x7f, 0x45, 0x4c, 0x46], 0);
  arm64Elf[4] = 2;
  arm64Elf[5] = 1;
  arm64Elf.writeUInt16LE(183, 18);

  assert.doesNotThrow(() => validateArm64Elf(arm64Elf));
  arm64Elf[4] = 1;
  assert.throws(() => validateArm64Elf(arm64Elf), /64-bit/);
  arm64Elf[4] = 2;
  arm64Elf.writeUInt16LE(62, 18);
  assert.throws(() => validateArm64Elf(arm64Elf), /AArch64/);
});

test("Kylin package build runs only on native Linux ARM64", () => {
  assert.doesNotThrow(() => assertKylinBuildHost("linux", "arm64"));
  assert.throws(
    () => assertKylinBuildHost("darwin", "arm64"),
    /requires native Linux ARM64/,
  );
  assert.throws(
    () => assertKylinBuildHost("linux", "x64"),
    /requires native Linux ARM64/,
  );
});

test("stages the offline package with exact wrappers, desktop entry, and modes", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-agent-kylin-package-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const resourceRoot = join(temporaryRoot, "resources");
  const stageDir = join(temporaryRoot, "stage");
  const iconSource = join(temporaryRoot, "icon.png");
  const metadataSource = join(temporaryRoot, "package.json");
  const arm64Elf = Buffer.alloc(64);
  arm64Elf.set([0x7f, 0x45, 0x4c, 0x46], 0);
  arm64Elf[4] = 2;
  arm64Elf[5] = 1;
  arm64Elf.writeUInt16LE(183, 18);

  await Promise.all([
    mkdir(join(resourceRoot, "node"), { recursive: true }),
    mkdir(join(resourceRoot, "server"), { recursive: true }),
    mkdir(
      join(resourceRoot, "playwright-browsers", "chromium-1232", "chrome-linux"),
      { recursive: true },
    ),
  ]);
  await Promise.all([
    writeFile(join(resourceRoot, "node", "node"), arm64Elf, { mode: 0o755 }),
    writeFile(join(resourceRoot, "node", "playwright-cli"), "#!/bin/sh\n", { mode: 0o755 }),
    writeFile(join(resourceRoot, "server", "desktop-server.cjs"), "require('./server.js');\n"),
    writeFile(join(resourceRoot, "server", "server.js"), "module.exports = {};\n"),
    writeFile(
      join(resourceRoot, "playwright-browsers", "chromium-1232", "chrome-linux", "chrome"),
      arm64Elf,
      { mode: 0o644 },
    ),
    writeFile(join(resourceRoot, "component-versions.json"), "{}\n"),
    writeFile(iconSource, "png"),
    writeFile(metadataSource, '{"version":"0.3.2"}\n'),
  ]);

  const result = await stageKylinPackage({
    resourceRoot,
    stageDir,
    launcherSource: join(root, "desktop", "kylin-launcher.cjs"),
    iconSource,
    metadataSource,
  });

  assert.equal(result.version, "0.3.2");
  const expectedModes = new Map([
    ["DEBIAN/control", 0o644],
    ["opt/pi-agent/launcher/pi-agent-kylin.cjs", 0o755],
    ["opt/pi-agent/resources/node/node", 0o755],
    ["opt/pi-agent/resources/node/playwright-cli", 0o755],
    ["opt/pi-agent/resources/playwright-browsers/chromium-1232/chrome-linux/chrome", 0o755],
    ["usr/bin/pi-agent-desktop", 0o755],
    ["usr/bin/pi-agent-playwright", 0o755],
    ["usr/share/applications/pi-agent-desktop.desktop", 0o644],
    ["usr/share/icons/hicolor/128x128/apps/pi-agent-desktop.png", 0o644],
  ]);
  for (const [relativePath, mode] of expectedModes) {
    const fileMode = (await stat(join(stageDir, relativePath))).mode & 0o777;
    assert.equal(fileMode, mode, `${relativePath} has the wrong mode`);
  }

  assert.equal(
    await readFile(join(stageDir, "usr", "bin", "pi-agent-desktop"), "utf8"),
    '#!/bin/sh\nexec /opt/pi-agent/resources/node/node /opt/pi-agent/launcher/pi-agent-kylin.cjs "$@"\n',
  );
  assert.equal(
    await readFile(join(stageDir, "usr", "bin", "pi-agent-playwright"), "utf8"),
    '#!/bin/sh\nexec /opt/pi-agent/resources/node/playwright-cli "$@"\n',
  );

  const desktopEntry = await readFile(
    join(stageDir, "usr", "share", "applications", "pi-agent-desktop.desktop"),
    "utf8",
  );
  assert.match(desktopEntry, /^Exec=pi-agent-desktop open$/m);
  assert.match(desktopEntry, /^Icon=pi-agent-desktop$/m);
  assert.match(desktopEntry, /^Terminal=false$/m);
  assert.match(desktopEntry, /^Categories=Development;$/m);

  const control = await readFile(join(stageDir, "DEBIAN", "control"), "utf8");
  assert.match(control, /^Architecture: arm64$/m);
  assert.match(control, /^Depends: libc6 \(>= 2\.28\), libstdc\+\+6, libgcc-s1$/m);
  assert.doesNotMatch(control, /webkit|appindicator|fonts-/i);

  const x64Elf = Buffer.from(arm64Elf);
  x64Elf.writeUInt16LE(62, 18);
  await writeFile(
    join(resourceRoot, "playwright-browsers", "chromium-1232", "chrome-linux", "chrome"),
    x64Elf,
    { mode: 0o755 },
  );
  await assert.rejects(
    stageKylinPackage({
      resourceRoot,
      stageDir,
      launcherSource: join(root, "desktop", "kylin-launcher.cjs"),
      iconSource,
      metadataSource,
    }),
    /Chromium.*AArch64/,
  );
});
