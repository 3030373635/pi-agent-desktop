/**
 * The set of `@earendil-works/*` packages this app bundles, derived from
 * package.json so it cannot drift when a pi package is added or removed.
 *
 * Deliberately NOT used for `serverExternalPackages` in next.config.ts: that
 * file is owned by agegr/pi-web upstream, which maintains its own copy of the
 * list. Deriving it here would manufacture a merge conflict on every sync.
 * See docs/ownership-boundaries.md.
 *
 * CLI:
 *   node scripts/pi-packages.mjs --install-spec 0.82.1  # npm install arguments
 *   node scripts/pi-packages.mjs --names                # bare package names
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const SCOPE = "@earendil-works/";

/** Fully scoped package names, e.g. `@earendil-works/pi-ai`. */
export async function piPackageNames() {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const names = Object.keys(pkg.dependencies ?? {})
    .filter((name) => name.startsWith(SCOPE))
    .sort();

  if (names.length === 0) {
    throw new Error("No @earendil-works/* dependencies found in package.json.");
  }
  return names;
}

/** Unscoped names, matching the directory layout under node_modules/@earendil-works. */
export async function piPackageDirNames() {
  return (await piPackageNames()).map((name) => name.slice(SCOPE.length));
}

async function main() {
  const [flag, version] = process.argv.slice(2);

  if (flag === "--names") {
    console.log((await piPackageNames()).join("\n"));
    return;
  }

  if (flag === "--install-spec") {
    if (!version) {
      console.error("--install-spec requires a version argument");
      process.exitCode = 2;
      return;
    }
    console.log((await piPackageNames()).map((name) => `${name}@${version}`).join(" "));
    return;
  }

  console.error("usage: node scripts/pi-packages.mjs --install-spec <version> | --names");
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
