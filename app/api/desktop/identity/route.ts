import {
  DESKTOP_INSTANCE_ID_ENV,
  DESKTOP_INSTANCE_ID_HEADER,
} from "@/lib/desktop-api";

export const dynamic = "force-dynamic";

// The packaged shell probes this endpoint before it creates the WebView. The
// random id is separate from the desktop API token: it proves that the server
// on the selected port is the child this process just spawned without exposing
// a filesystem authorization credential over HTTP.
export async function GET() {
  const instanceId = process.env[DESKTOP_INSTANCE_ID_ENV]?.trim();
  if (!instanceId) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      [DESKTOP_INSTANCE_ID_HEADER]: instanceId,
      "Cache-Control": "no-store",
    },
  });
}
