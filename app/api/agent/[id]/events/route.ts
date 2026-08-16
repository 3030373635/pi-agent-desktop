import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { projectAgentEventForClient } from "@/lib/agent-event-wire";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    try {
      ({ session } = await startRpcSession(id, filePath, undefined));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  let dispose = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        req.signal?.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed/cancelled */ }
      };
      const encode = (data: unknown) => {
        if (closed) return false;
        const text = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      dispose = cleanup;
      req.signal?.addEventListener("abort", cleanup);

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      if (!closed) {
        const nextUnsubscribe = session.onEvent((event) => {
          const clientEvent = projectAgentEventForClient(event);
          if (clientEvent) encode(clientEvent);
        });
        if (closed) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      }

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      if (!closed) heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(":\n\n")); }
        catch { cleanup(); }
      }, 30_000);

    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
