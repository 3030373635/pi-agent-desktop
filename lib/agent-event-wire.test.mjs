import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { projectAgentEventForClient } = await jiti.import("./agent-event-wire.ts");

test("projects Pi SDK message updates to the 0.84 delta-only wire shape", () => {
  const partial = { role: "assistant", content: [{ type: "text", text: "Hello" }] };
  const event = {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "o", partial },
  };

  assert.deepEqual(projectAgentEventForClient(event), {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "o" },
  });
  assert.equal(event.assistantMessageEvent.partial, partial, "projection must not mutate the SDK event");
});

test("omits noisy events and minimizes agent_end", () => {
  assert.equal(projectAgentEventForClient({ type: "tool_execution_update" }), null);
  assert.deepEqual(
    projectAgentEventForClient({ type: "agent_end", messages: [{ role: "assistant" }], willRetry: false }),
    { type: "agent_end" },
  );
});
