import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getAppViewportHeightCss, getTranslucentColorCss } = await jiti.import("./browser-compat.ts");

test("uses a Chrome 102-safe viewport fallback without an offset", () => {
  assert.equal(
    getAppViewportHeightCss(),
    "var(--app-viewport-height, 100vh)",
  );
});

test("subtracts fixed chrome from the compatible viewport height", () => {
  assert.equal(
    getAppViewportHeightCss(16),
    "calc(var(--app-viewport-height, 100vh) - 16px)",
  );
});

test("builds translucent theme colors without color-mix", () => {
  assert.equal(
    getTranslucentColorCss("danger", 0.16),
    "rgba(var(--danger-rgb), 0.16)",
  );
});

test("rejects an invalid translucent color opacity", () => {
  assert.throws(
    () => getTranslucentColorCss("danger", 1.1),
    /between 0 and 1/,
  );
});
