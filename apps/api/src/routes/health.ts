import { Hono } from "hono";
import {
  authorizeDeepHealth,
  buildDeepHealthFailureResponse,
  runDeepHealthChecks,
} from "@flamenode/server-core/health/deepHealth";
import type { AppEnv } from "../env.ts";

// CURRENT: src/lib/health/publicHealth.ts, src/lib/health/deepHealth.ts
// (authorizeDeepHealth), app/api/health/route.ts, app/api/health/deep/route.ts.
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function stringBinding(env: unknown, key: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export const healthRoutes = new Hono<AppEnv>();

// RH-018: GET /api/health — exposes only the validated deployment commit.
healthRoutes.get("/", (c) => {
  let commit: string;
  try {
    commit = stringBinding(c.env, "BUILD_COMMIT_SHA")?.trim() ?? "";
  } catch {
    // Cloudflare environment getters can throw synchronously. Never expose provider details.
    return Response.json(
      { ok: false, service: "flamenode-web", runtime: "cloudflare-worker" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!COMMIT_PATTERN.test(commit)) {
    return Response.json(
      { ok: false, service: "flamenode-web", runtime: "cloudflare-worker" },
      { status: 503, headers: NO_STORE },
    );
  }
  return Response.json(
    {
      ok: true,
      service: "flamenode-web",
      commit: commit.toLowerCase(),
      runtime: "cloudflare-worker",
    },
    { headers: NO_STORE },
  );
});

// RH-017: same token gate and read-only D1/KV/R2/Queue/visibility diagnostics as CURRENT.
// Missing required bindings fail closed; the production Worker Route is not changed.
healthRoutes.get("/deep", async (c) => {
  // Authorization must finish before reading any diagnostic bindings.
  let configuredToken: string | undefined;
  try {
    configuredToken = stringBinding(c.env, "WORKER_ADMIN_TOKEN");
  } catch {
    return buildDeepHealthFailureResponse(undefined);
  }
  const unauthorized = authorizeDeepHealth(c.req.raw, configuredToken);
  if (unauthorized) return unauthorized;

  try {
    const { DB, KV, BUCKET } = c.env;
    if (!DB || !KV || !BUCKET) {
      // No silent success if the runtime lacks a mandatory read-only diagnostic binding.
      return Response.json(
        { ok: false, service: "flamenode-web" },
        { status: 503, headers: NO_STORE },
      );
    }
    const result = await runDeepHealthChecks({ ...c.env, DB, KV, BUCKET });
    return Response.json(result, {
      status: result.status === "degraded" ? 200 : result.ok ? 200 : 503,
      headers: NO_STORE,
    });
  } catch (error) {
    return buildDeepHealthFailureResponse(error);
  }
});
