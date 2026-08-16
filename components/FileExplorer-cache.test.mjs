import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("collapsed loaded directories become stale and reload when expanded", () => {
  const nodeSource = source.slice(
    source.indexOf("function TreeNode("),
    source.indexOf("function SearchResultRow("),
  );
  assert.match(nodeSource, /const staleRef = useRef\(false\)/);
  assert.match(nodeSource, /lastRefreshTokenRef\.current === refreshToken/);
  assert.match(nodeSource, /if \(loading\) staleRef\.current = true/);
  assert.match(nodeSource, /else \{\s*staleRef\.current = true;/);
  assert.match(nodeSource, /open && !loading && \(!loaded \|\| staleRef\.current\)/);
  assert.match(nodeSource, /const force = loaded;[\s\S]*?loadChildren\(force\)/);
});
