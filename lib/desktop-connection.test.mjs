import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const connectionSource = new URL("./desktop-connection.ts", import.meta.url);
const nativeSource = new URL("./desktop-native.ts", import.meta.url);

test("desktop health probes ignore superseded wake-up requests", async () => {
  const source = await readFile(connectionSource, "utf8");
  assert.match(source, /probeControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /probeControllerRef\.current !== controller/);
  assert.match(source, /probeControllerRef\.current === controller/);
});

test("Reconnect refreshes healthy connections and relaunches a dead local server", async () => {
  const [connection, native] = await Promise.all([
    readFile(connectionSource, "utf8"),
    readFile(nativeSource, "utf8"),
  ]);
  assert.match(connection, /window\.location\.reload\(\)/);
  assert.match(connection, /await relaunchAppNative\(\)/);
  assert.match(native, /import\("@tauri-apps\/plugin-process"\)/);
  assert.match(native, /await relaunch\(\)/);
});
