import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ExtensionStatusBar,
  formatExtensionStatusLine,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("sanitizes status text for a single-line display", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second third",
  );
});

test("strips leading decorative status markers including ANSI-colored bullets", () => {
  assert.equal(
    sanitizeExtensionStatusText("\x1b[32m●\x1b[0m tools:2 err:0 last:bash"),
    "tools:2 err:0 last:bash",
  );
  assert.equal(
    sanitizeExtensionStatusText("● tools:2 err:0 last:bash"),
    "tools:2 err:0 last:bash",
  );
});

test("renders a single status line without identifier keys", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExtensionStatusBar, {
      statuses: [
        { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
        { key: "05-ponytail", text: "ponytail" },
      ],
    }),
  );

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /height:32px/);
  assert.doesNotMatch(html, /border-top/);
  assert.doesNotMatch(html, /background:var\(--bg-panel\)/);
  assert.match(html, />ponytail <\/span>/);
  assert.match(html, />memory</);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
});
