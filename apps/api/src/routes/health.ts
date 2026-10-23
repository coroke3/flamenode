import { Hono } from "hono";
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

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function deepHealthUnavailable(): Response {
  return Response.json(
    { ok: false, service: "flamenode-web" },
    { status: 503, headers: NO_STORE },
  );
}

export const healthRoutes = new Hono<AppEnv>();

// RH-018: GET /api/health — exposes only the validated deployment commit.
healthRoutes.get("/", (c) => {
  const commit = stringBinding(c.env, "BUILD_COMMIT_SHA")?.trim() ?? "";
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

// RH-017: GET /api/health/deep
//
// The token gate matches CURRENT exactly (503 when WORKER_ADMIN_TOKEN is not
// configured, 401 for a missing/malformed/wrong Bearer token).
//
// The authorized check body (schema version + runtime tables, tracked detail
// artifact SLO, global artifact SLO probes, queue configuration and the
// public-visibility manifest/fence join) still lives only in
// src/lib/health/deepHealth.ts and its ~2,000-line public-data normalizer
// closure, which apps/api must not import. Until that logic moves into a
// package, this route fails closed with CURRENT's own failure response
// instead of reporting checks it did not run as "ok". It reads no D1/KV/R2.
healthRoutes.get("/deep", (c) => {
  const token = stringBinding(c.env, "WORKER_ADMIN_TOKEN")?.trim();
  if (!token) return deepHealthUnavailable();

  const match = /^Bearer ([^\s]+)$/.exec(c.req.header("Authorization") ?? "");
  if (!match || !constantTimeEqual(match[1], token)) {
    return Response.json(
      { ok: false, service: "flamenode-web" },
      { status: 401, headers: NO_STORE },
    );
  }

  return deepHealthUnavailable();
});
