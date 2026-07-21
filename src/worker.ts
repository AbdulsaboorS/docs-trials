import { realtimekitTrial } from "./fixture";
import { runLocalTrial } from "./local-runner";
import type { PlatformEnv } from "./platform-env";

export { Sandbox } from "@cloudflare/sandbox";
export { RunAdmission } from "./run-admission";
export { TrialCodingAgent } from "./trial-agent";
export { TrialWorkflow } from "./trial-workflow";

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        cloudExecutionEnabled: false,
      });
    }
    if (
      request.method === "GET" &&
      ["/trials/realtimekit-video-room-v1", "/api/trials/realtimekit-video-room-v1"].includes(
        url.pathname,
      )
    ) {
      return Response.json(realtimekitTrial);
    }
    if (
      request.method === "POST" &&
      [
        "/trials/realtimekit-video-room-v1/local",
        "/api/trials/realtimekit-video-room-v1/local",
      ].includes(url.pathname)
    ) {
      return Response.json(runLocalTrial(realtimekitTrial));
    }
    if (request.method === "POST" && url.pathname === "/api/trials/realtimekit-video-room-v1/run") {
      return cloudExecutionDisabled();
    }
    if (request.method === "POST" && url.pathname === "/api/grade/realtimekit") {
      return cloudExecutionDisabled();
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<PlatformEnv>;

function cloudExecutionDisabled(): Response {
  return Response.json(
    {
      error:
        "Controlled cloud execution is disabled until Artifacts access and ADR 0007 admission controls are verified.",
    },
    { status: 503 },
  );
}
