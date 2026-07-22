import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateUpdaterPublicKey(value) {
  const publicKey = value?.trim();
  if (!publicKey) {
    throw new Error("TAURI_UPDATER_PUBLIC_KEY is required");
  }

  if (
    publicKey.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)
  ) {
    throw new Error(
      "TAURI_UPDATER_PUBLIC_KEY must be the Base64 contents of the Tauri-generated .pub file",
    );
  }

  const decoded = Buffer.from(publicKey, "base64").toString("utf8");
  const lines = decoded.trimEnd().split(/\r?\n/);
  if (
    !lines[0]?.startsWith("untrusted comment:") ||
    !lines[1]?.startsWith("RW")
  ) {
    throw new Error(
      "TAURI_UPDATER_PUBLIC_KEY does not decode to a Minisign public key",
    );
  }

  return publicKey;
}

export function injectUpdaterPublicKey(config, value) {
  const publicKey = validateUpdaterPublicKey(value);
  return {
    ...config,
    plugins: {
      ...config.plugins,
      updater: {
        ...config.plugins?.updater,
        pubkey: publicKey,
      },
    },
  };
}

export async function configureUpdaterPublicKey({
  publicKey,
  configPath = "src-tauri/tauri.conf.json",
}) {
  const resolvedPath = resolve(configPath);
  const config = JSON.parse(await readFile(resolvedPath, "utf8"));
  const configured = injectUpdaterPublicKey(config, publicKey);
  await writeFile(resolvedPath, `${JSON.stringify(configured, null, 2)}\n`);
  return resolvedPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = await configureUpdaterPublicKey({
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
    configPath: process.argv[2],
  });
  console.log(`Configured updater public key in ${configPath}`);
}
