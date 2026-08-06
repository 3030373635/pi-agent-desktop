import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { normalizeToolCalls } from "./normalize";
import type { AgentMessage, AssistantMessage, AssistantContentBlock } from "./types";

export type ClientAssistantMessageEvent = AssistantMessageEvent extends infer Event
  ? Event extends { partial: unknown }
    ? Omit<Event, "partial">
    : Event
  : never;

function isAssistantMessage(message: Partial<AgentMessage> | null): message is AssistantMessage {
  return message?.role === "assistant" && Array.isArray(message.content);
}

function replaceContentBlock(
  message: AssistantMessage,
  contentIndex: number,
  block: AssistantContentBlock,
): AssistantMessage {
  const content = [...message.content];
  content[contentIndex] = block;
  return { ...message, content };
}

/**
 * Applies Pi 0.84's delta-only wire event to the current streaming message.
 * message_end remains authoritative; this reducer is only for the live bubble.
 */
export function applyAssistantMessageEvent(
  current: Partial<AgentMessage> | null,
  event: ClientAssistantMessageEvent,
): Partial<AgentMessage> | null {
  if (event.type === "done") return normalizeToolCalls(event.message as AgentMessage);
  if (event.type === "error") return normalizeToolCalls(event.error as AgentMessage);
  if (!isAssistantMessage(current)) return current;

  switch (event.type) {
    case "start":
      return current;
    case "text_start":
      return replaceContentBlock(current, event.contentIndex, { type: "text", text: "" });
    case "text_delta": {
      const block = current.content[event.contentIndex];
      const text = block?.type === "text" ? block.text : "";
      return replaceContentBlock(current, event.contentIndex, { type: "text", text: text + event.delta });
    }
    case "text_end":
      return replaceContentBlock(current, event.contentIndex, { type: "text", text: event.content });
    case "thinking_start":
      return replaceContentBlock(current, event.contentIndex, { type: "thinking", thinking: "" });
    case "thinking_delta": {
      const block = current.content[event.contentIndex];
      const thinking = block?.type === "thinking" ? block.thinking : "";
      return replaceContentBlock(current, event.contentIndex, { type: "thinking", thinking: thinking + event.delta });
    }
    case "thinking_end":
      return replaceContentBlock(current, event.contentIndex, { type: "thinking", thinking: event.content });
    case "toolcall_end": {
      const next = replaceContentBlock(current, event.contentIndex, event.toolCall as unknown as AssistantContentBlock);
      return normalizeToolCalls(next as AgentMessage);
    }
    // Pi's partial-free toolcall_start/toolcall_delta events do not carry the
    // tool id/name or parsed arguments. toolcall_end supplies the authoritative
    // ToolCall, so keep the live message unchanged until then.
    case "toolcall_start":
    case "toolcall_delta":
      return current;
  }
}
