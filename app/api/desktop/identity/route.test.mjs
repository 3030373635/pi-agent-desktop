import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const envName = "PI_DESKTOP_INSTANCE_ID";
const originalInstanceId = process.env[envName];
const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./route.ts");

afterEach(() => {
  if (originalInstanceId === undefined) delete process.env[envName];
  else process.env[envName] = originalInstanceId;
});

test("desktop identity is unavailable outside a packaged server", async () => {
  delete process.env[envName];
  const response = await GET();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-pi-desktop-instance"), null);
});

test("desktop identity returns only the packaged instance id header", async () => {
  process.env[envName] = "test-instance-id";
  const response = await GET();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-pi-desktop-instance"), "test-instance-id");
  assert.equal(await response.text(), "");
});
