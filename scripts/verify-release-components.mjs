import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareVersions,
  createComponentManifest,
  readLocalComponentVersions,
  readRemoteComponentVersions,
  rootDir,
} from "./release-components.mjs";

const local = await readLocalComponentVersions();
const remote = await readRemoteComponentVersions();
const problems = [];
if (compareVersions(local.pi, remote.pi.version) !== 0) {
  problems.push(`pi is ${local.pi}; latest Release is ${remote.pi.version}`);
}
if (compareVersions(local["pi-web"], remote["pi-web"].version) !== 0) {
  problems.push(`pi-web is ${local["pi-web"]}; latest Release is ${remote["pi-web"].version}`);
}
if (remote["pi-gui"] && compareVersions(local["pi-gui"], remote["pi-gui"].version) < 0) {
  problems.push(`pi-gui is ${local["pi-gui"]}; latest Release is ${remote["pi-gui"].version}`);
}

const expectedManifest = createComponentManifest(local);
const actualManifest = JSON.parse(await readFile(
  join(rootDir, "src-tauri", "resources", "component-versions.json"),
  "utf8",
));
if (JSON.stringify(actualManifest) !== JSON.stringify(expectedManifest)) {
  problems.push("component-versions.json does not match the bundled package versions");
}

if (problems.length > 0) {
  throw new Error(`Release verification failed:\n- ${problems.join("\n- ")}`);
}
console.log(`Verified pi-gui ${local["pi-gui"]}, pi ${local.pi}, pi-web ${local["pi-web"]}.`);
