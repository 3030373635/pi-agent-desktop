import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { applyAssistantMessageEvent } = await jiti.import("./streaming-message.ts");

function assistant(content = []) {
  return { role: "assistant", content, model: "test-model", provider: "test-provider" };
}

test("assembles Pi 0.84 text and thinking deltas without cumulative snapshots", () => {
  let message = assistant();
  message = applyAssistantMessageEvent(message, { type: "text_start", contentIndex: 0 });
  message = applyAssistantMessageEvent(message, { type: "text_delta", contentIndex: 0, delta: "Hel" });
  message = applyAssistantMessageEvent(message, { type: "text_delta", contentIndex: 0, delta: "lo" });
  message = applyAssistantMessageEvent(message, { type: "thinking_start", contentIndex: 1 });
  message = applyAssistantMessageEvent(message, { type: "thinking_delta", contentIndex: 1, delta: "Plan" });

  assert.deepEqual(message.content, [
    { type: "text", text: "Hello" },
    { type: "thinking", thinking: "Plan" },
  ]);
});

test("normalizes a completed streamed tool call", () => {
  const message = applyAssistantMessageEvent(assistant(), {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
  });

  assert.deepEqual(message.content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "read",
    input: { path: "README.md" },
  });
});

test("uses done and error messages as authoritative streaming snapshots", () => {
  const completed = assistant([{ type: "text", text: "done" }]);
  assert.deepEqual(
    applyAssistantMessageEvent(null, { type: "done", reason: "stop", message: completed }),
    completed,
  );

  const failed = { ...completed, stopReason: "error", errorMessage: "failed" };
  assert.deepEqual(
    applyAssistantMessageEvent(null, { type: "error", reason: "error", error: failed }),
    failed,
  );
});
