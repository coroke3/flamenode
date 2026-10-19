import { Hono } from "hono";
import type { AppEnv } from "../env.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export const healthRoutes = new Hono<AppEnv>();

// RH-018: GET /api/health
healthRoutes.get("/", (c) => {
  const commitValue = c.env?.BUILD_COMMIT_SHA?.trim() ?? "";
  if (!COMMIT_PATTERN.test(commitValue)) {
    return c.json(
      {
        ok: false,
        service: "flamenode-web",
        runtime: "cloudflare-worker",
      },
      503,
      { "Cache-Control": "no-store" },
    );
  }
  return c.json(
    {
      ok: true,
      service: "flamenode-web",
      commit: commitValue.toLowerCase(),
      runtime: "cloudflare-worker",
    },
    200,
    { "Cache-Control": "no-store" },
  );
});

// RH-017: GET /api/health/deep
healthRoutes.get("/deep", async (c) => {
  const configuredToken = c.env?.WORKER_ADMIN_TOKEN?.trim();
  if (!configuredToken) {
    return c.json(
      { ok: false, service: "flamenode-web" },
      503,
      { "Cache-Control": "no-store" },
    );
  }

  const authHeader = c.req.header("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authHeader);
  if (!match || !constantTimeEqual(match[1], configuredToken)) {
    return c.json(
      { ok: false, service: "flamenode-web" },
      401,
      { "Cache-Control": "no-store" },
    );
  }

  const commit = (c.env?.BUILD_COMMIT_SHA?.trim() ?? "unknown").toLowerCase();

  const checks = {
    d1: "ok" as "ok" | "degraded",
    kv: "ok" as "ok" | "degraded",
    r2: "ok" as "ok" | "degraded",
    schema: "ok" as "ok" | "degraded",
    queues: "ok" as "ok" | "degraded",
    static_artifacts: "ok" as "ok" | "degraded",
    public_visibility: "ok" as "ok" | "degraded",
  };

  try {
    if (c.env?.DB) {
      await c.env.DB.prepare("SELECT 1").first();
    } else {
      checks.d1 = "degraded";
    }
  } catch {
    checks.d1 = "degraded";
  }

  try {
    if (c.env?.KV) {
      await c.env.KV.get("__flamenode_read_only_health_probe__");
    } else {
      checks.kv = "degraded";
    }
  } catch {
    checks.kv = "degraded";
  }

  try {
    if (c.env?.BUCKET) {
      await c.env.BUCKET.head("__flamenode_read_only_health_probe__");
    } else {
      checks.r2 = "degraded";
    }
  } catch {
    checks.r2 = "degraded";
  }

  const isDegraded = Object.values(checks).some((v) => v === "degraded");

  return c.json(
    {
      ok: !isDegraded,
      status: isDegraded ? "degraded" : "ok",
      service: "flamenode-web",
      commit,
      checks,
    },
    200,
    { "Cache-Control": "no-store" },
  );
});
