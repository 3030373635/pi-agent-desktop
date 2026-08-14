import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
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
      dispose = cleanup;
      req.signal?.addEventListener("abort", cleanup);
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

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const nextUnsubscribe = subscribeRunningSessions((ids) => {
        encode({ type: "running", runningSessionIds: ids });
      });
      if (closed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      encode({ type: "running", runningSessionIds: getRunningRpcSessionIds() });

      // Heartbeat to keep the connection alive through proxies/timeouts.
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
