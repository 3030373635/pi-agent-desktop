import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./desktop-api-auth.ts");
}

function request(token, origin = "http://localhost:30141") {
  const headers = {
    host: "localhost:30141",
    origin,
    "sec-fetch-site": origin === "http://localhost:30141" ? "same-origin" : "cross-site",
  };
  if (token) headers["x-pi-desktop-token"] = token;
  return new Request("http://localhost:30141/api/desktop/save", {
    method: "POST",
    headers,
  });
}

test("desktop filesystem APIs require the per-process token", async () => {
  const { isDesktopApiRequestAllowed } = await loadSubject();
  const token = "a".repeat(64);

  assert.equal(isDesktopApiRequestAllowed(request(token), token), true);
  assert.equal(isDesktopApiRequestAllowed(request(null), token), false);
  assert.equal(isDesktopApiRequestAllowed(request("b".repeat(64)), token), false);
  assert.equal(isDesktopApiRequestAllowed(request(token), ""), false);
});

test("desktop token never bypasses the normal host and origin checks", async () => {
  const { isDesktopApiRequestAllowed } = await loadSubject();
  const token = "a".repeat(64);

  assert.equal(
    isDesktopApiRequestAllowed(request(token, "https://attacker.example"), token),
    false,
  );

  const lan = new Request("http://localhost:30141/api/desktop/save", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7:30141",
      "sec-fetch-site": "same-origin",
      "x-pi-desktop-token": token,
    },
  });
  assert.equal(isDesktopApiRequestAllowed(lan, token), false);
});
