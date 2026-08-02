import { getEnv } from "@/lib/cloudflare";
import {
  authorizeDeepHealth,
  runDeepHealthChecks,
} from "@/lib/health/deepHealth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch {
    return Response.json(
      { ok: false, service: "flamenode-web" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const unauthorized = authorizeDeepHealth(request, env.WORKER_ADMIN_TOKEN);
  if (unauthorized) return unauthorized;

  try {
    const result = await runDeepHealthChecks(env);
    return Response.json(result, {
      status: result.status === "degraded" ? 200 : result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { ok: false, service: "flamenode-web" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
