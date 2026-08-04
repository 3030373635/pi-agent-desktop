import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./scroll-memory.ts");
}

test("remembers a mid-list position and returns it later", async () => {
  const { rememberScrollPosition, sessionScrollTops } = await loadSubject();
  rememberScrollPosition("mid-list", { scrollTop: 1200, scrollHeight: 5000, clientHeight: 800 });
  assert.equal(sessionScrollTops.get("mid-list"), 1200);
});

test("a viewport at the bottom is forgotten so restore follows the tail", async () => {
  const { rememberScrollPosition, sessionScrollTops, BOTTOM_FOLLOW_EPSILON_PX } = await loadSubject();
  rememberScrollPosition("at-bottom", { scrollTop: 1000, scrollHeight: 5000, clientHeight: 800 });
  assert.equal(sessionScrollTops.get("at-bottom"), 1000);
  // Now the user is within epsilon of the bottom — the stale entry must go.
  rememberScrollPosition("at-bottom", {
    scrollTop: 4200 - BOTTOM_FOLLOW_EPSILON_PX,
    scrollHeight: 5000,
    clientHeight: 800,
  });
  assert.equal(sessionScrollTops.get("at-bottom"), undefined);
});

test("the cache evicts the least recently written entry past the cap", async () => {
  const { LruNumberCache } = await loadSubject();
  const cache = new LruNumberCache();
  for (let i = 0; i < 50; i++) cache.set(`s${i}`, i);
  cache.set("s0", 999); // refresh recency of the oldest entry
  cache.set("s50", 50); // push past the cap → s1 (now oldest) is evicted
  assert.equal(cache.get("s1"), undefined);
  assert.equal(cache.get("s0"), 999);
  assert.equal(cache.get("s50"), 50);
});
