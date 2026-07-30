import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./bounded-form-data.ts");
}

function multipartBody(boundary, value) {
  return `--${boundary}\r\nContent-Disposition: form-data; name="value"\r\n\r\n${value}\r\n--${boundary}--\r\n`;
}

test("rejects a declared oversized request before reading its body", async () => {
  const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-length": "99", "content-type": "multipart/form-data; boundary=test" },
    body: multipartBody("test", "small"),
  });

  await assert.rejects(() => parseFormDataWithinLimit(request, 10), RequestBodyTooLargeError);
});

test("stops a chunked request once its body exceeds the limit", async () => {
  const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("1234"));
      controller.enqueue(new TextEncoder().encode("5678"));
      controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: stream,
    duplex: "half",
  });

  await assert.rejects(() => parseFormDataWithinLimit(request, 6), RequestBodyTooLargeError);
});

test("parses multipart data inside the request limit", async () => {
  const { parseFormDataWithinLimit } = await loadSubject();
  const boundary = "test";
  const body = multipartBody(boundary, "small");
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const formData = await parseFormDataWithinLimit(request, body.length + 1);
  assert.equal(formData.get("value"), "small");
});

test("reads raw bytes only up to the configured limit", async () => {
  const { readRequestBytesWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const accepted = new Request("http://localhost/save", {
    method: "POST",
    body: "123456",
  });
  assert.equal(
    new TextDecoder().decode(await readRequestBytesWithinLimit(accepted, 6)),
    "123456",
  );

  const rejected = new Request("http://localhost/save", {
    method: "POST",
    body: "1234567",
  });
  await assert.rejects(
    () => readRequestBytesWithinLimit(rejected, 6),
    RequestBodyTooLargeError,
  );
});

test("parses bounded JSON and treats malformed JSON as invalid", async () => {
  const { parseJsonWithinLimit } = await loadSubject();
  const valid = new Request("http://localhost/json", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await parseJsonWithinLimit(valid, 64), { ok: true });

  const malformed = new Request("http://localhost/json", {
    method: "POST",
    body: "{",
  });
  assert.equal(await parseJsonWithinLimit(malformed, 64), null);
});
