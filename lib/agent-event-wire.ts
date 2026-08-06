import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

type SdkMessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;

const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end", "tool_execution_update"]);

/** Projects in-process SDK events onto Pi 0.84's linear-size JSON wire shape. */
export function projectAgentEventForClient(event: AgentEventLike): AgentEventLike | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const sdkEvent = event as unknown as SdkMessageUpdateEvent;
    const assistantMessageEvent = { ...sdkEvent.assistantMessageEvent } as unknown as Record<string, unknown>;
    delete assistantMessageEvent.partial;
    return { type: "message_update", assistantMessageEvent };
  }
  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}
