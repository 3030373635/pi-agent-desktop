import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import postcss from "postcss";
import chrome102Compat from "./postcss-chrome-102-compat.cjs";

/**
 * Process CSS with the Chrome 102 compatibility plugin.
 *
 * @param {string} css - CSS source containing declarations to transform.
 * @returns {Promise<string>} Transformed CSS including legacy fallbacks.
 */
async function transform(css) {
  const result = await postcss([chrome102Compat]).process(css, { from: undefined });
  return result.css;
}

test("adds an rgba fallback before a translucent theme color mix", async () => {
  const css = await transform("a { background: color-mix(in srgb, var(--danger) 16%, transparent); }");
  assert.match(css, /background: rgba\(var\(--danger-rgb\), 0\.16\);/);
  assert.match(css, /background: color-mix\(in srgb, var\(--danger\) 16%, transparent\);/);
  assert.ok(css.indexOf("rgba(") < css.indexOf("color-mix("));
});

test("uses the dominant theme token when both mix colors are variables", async () => {
  const css = await transform("a { color: color-mix(in srgb, var(--text) 88%, var(--text-muted)); }");
  assert.match(css, /color: var\(--text\);/);
});

test("adds a fallback inside gradients without removing the modern declaration", async () => {
  const css = await transform("a { background: linear-gradient(white, color-mix(in srgb, var(--accent) 4%, transparent)); }");
  assert.match(css, /linear-gradient\(white, rgba\(var\(--accent-rgb\), 0\.04\)\)/);
  assert.match(css, /linear-gradient\(white, color-mix\(/);
});

test("adds a fallback for Tailwind oklab current-color mixes", async () => {
  const css = await transform("a { color: color-mix(in oklab, currentColor 50%, transparent); }");
  assert.match(css, /color: currentColor;/);
  assert.match(css, /color: color-mix\(in oklab, currentColor 50%, transparent\);/);
});

test("uses transparent for a low-opacity current-color fallback", async () => {
  const css = await transform("a { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 9%, transparent); }");
  assert.match(css, /box-shadow: 0 0 0 3px transparent;/);
});

test("supports a leading-decimal color percentage", async () => {
  const css = await transform("a { background: color-mix(in srgb, var(--danger) .5%, transparent); }");
  assert.match(css, /background: rgba\(var\(--danger-rgb\), 0\.005\);/);
});

test("loads through the Next webpack PostCSS configuration path", async () => {
  const require = createRequire(import.meta.url);
  const { getPostCssPlugins } = require("next/dist/build/webpack/config/blocks/css/plugins");
  const plugins = await getPostCssPlugins(process.cwd(), ["chrome 102"]);
  const result = await postcss(plugins).process(
    "a { background: color-mix(in srgb, var(--danger) 16%, transparent); }",
    { from: undefined },
  );

  assert.match(result.css, /background: rgba\(var\(--danger-rgb\), 0\.16\);/);
});
