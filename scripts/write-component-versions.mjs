import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createComponentManifest,
  readLocalComponentVersions,
  rootDir,
} from "./release-components.mjs";

const destination = join(rootDir, "src-tauri", "resources", "component-versions.json");
const manifest = createComponentManifest(await readLocalComponentVersions());
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${destination}`);
