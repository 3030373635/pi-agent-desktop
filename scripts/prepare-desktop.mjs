import { access, chmod, copyFile, cp, mkdir, rm } from "node:fs/promises";
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
const windowsNodeDir = join(rootDir, "src-tauri", "resources", "node");

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

  throw new Error("Could not locate npm next to the Windows Node.js runtime.");
}

async function bundleNodeRuntime() {
  const triple = desktopTargetTriple();
  await rm(serverHelperDir, { recursive: true, force: true });
  await rm(windowsNodeDir, { recursive: true, force: true });

  let binaryPath;
  if (process.platform === "darwin") {
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
    binaryPath = join(windowsNodeDir, "node.exe");
    await mkdir(windowsNodeDir, { recursive: true });
    await copyFile(process.execPath, binaryPath);
    await cp(
      await findNpmSource(),
      join(windowsNodeDir, "node_modules", "npm"),
      { recursive: true },
    );
  }

  return { binaryPath, triple };
}

await runNextBuild();
await assembleServer();
const { binaryPath: nodeBinary, triple } = await bundleNodeRuntime();

console.log(`Desktop server staged at ${serverResourcesDir}`);
console.log(`Node runtime staged at ${nodeBinary} (${triple})`);
