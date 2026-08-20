import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getSupportedBrowsers } = require("next/dist/build/get-supported-browsers");

test("production client bundles target Chrome 102", () => {
  const browsers = getSupportedBrowsers(process.cwd(), false);
  assert.ok(browsers.includes("chrome 102"), browsers.join(", "));
});

test("development client bundles target Chrome 102", () => {
  const browsers = getSupportedBrowsers(process.cwd(), true);
  assert.ok(browsers.includes("chrome 102"), browsers.join(", "));
});
