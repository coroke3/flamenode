import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { cancelR2BodyBestEffort } from "@flamenode/server-core/r2Body";
import {
  checkPublicApiRateLimit,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@flamenode/server-core/publicData/publicApi";
import { assertNoForbiddenKeys } from "@flamenode/server-core/publicData/publicDto";
import {
  normalizePublicEventStaffArtifact,
  parsePublicEventId,
  resolvePvsfPublicApiOrigin,
} from "@flamenode/server-core/publicData/publicEventStaff";
import { eventBaseObjectKey } from "@flamenode/server-core/publicData/eventDetailCore";
import {
  buildPublicArtifactVisibilityContext,
  filterPublicArtifactPayload,
} from "@flamenode/server-core/publicData/artifactVisibility";
import { isEntityBlockedInManifest } from "@flamenode/server-core/visibility/manifestCore";
import { readVisibilityManifestObject } from "@flamenode/server-core/visibility/manifestR2";

/** CURRENT RH-027/028: no DB read, no Cache API, no trust in stale R2 without a committed fence. */
export const publicEventStaffRoutes = new Hono<AppEnv>();
const MAX_BYTES = 2 * 1024 * 1024;
const SUCCESS_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const ALLOWED_PREFLIGHT_HEADERS = new Set(["if-none-match"]);
type ReadBucket = Pick<R2Bucket, "get">;

function appendVary(headers: Headers, value: string): void {
  const values = new Set(
    (headers.get("Vary") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function withCors(request: Request, response: Response): Response {
  appendVary(response.headers, "Origin");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  const origin = resolvePvsfPublicApiOrigin(request.headers.get("Origin"));
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "ETag, Retry-After");
  }
  return response;
}

function getBucket(env: AppEnv["Bindings"]): ReadBucket | null {
  try {
    const candidate: unknown = env?.BUCKET;
    return candidate !== null && typeof candidate === "object" &&
      typeof (candidate as { get?: unknown }).get === "function"
      ? candidate as ReadBucket : null;
  } catch {
    return null;
  }
}

async function notFound(request: Request): Promise<Response> {
  return withCors(request, await publicJsonResponse(request, { error: "not_found" }, "no-store", 404));
}

function unavailable(request: Request, code: string): Response {
  return withCors(request, publicServiceUnavailableResponse(code));
}

async function readStrictManifest(bucket: ReadBucket) {
  // The low-level reader deliberately allows missing R2 manifests for CAS producers.
  // Public reads never accept that bootstrap state: a committed ETag is mandatory.
  const current = await readVisibilityManifestObject(bucket);
  if (!current.etag?.trim()) throw new Error("public_visibility_manifest_missing");
  return current;
}

publicEventStaffRoutes.options("/:id/staff", (c) => {
  const request = c.req.raw;
  const origin = resolvePvsfPublicApiOrigin(request.headers.get("Origin"));
  const method = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  const headers = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!origin || (method !== undefined && method !== "GET" && method !== "HEAD") ||
      headers.some((h) => !ALLOWED_PREFLIGHT_HEADERS.has(h))) {
    const denied = new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    appendVary(denied.headers, "Access-Control-Request-Method");
    appendVary(denied.headers, "Access-Control-Request-Headers");
    return withCors(request, denied);
  }
  const response = new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "3600",
      "Cache-Control": "public, max-age=3600",
    },
  });
  appendVary(response.headers, "Access-Control-Request-Method");
  appendVary(response.headers, "Access-Control-Request-Headers");
  return withCors(request, response);
});

publicEventStaffRoutes.get("/:id/staff", async (c) => {
  const request = c.req.raw;
  const limited = checkPublicApiRateLimit(request, "/api/public/events/:id/staff");
  if (limited) return withCors(request, limited);
  const eventId = parsePublicEventId(c.req.param("id"));
  if (!eventId) return notFound(request);

  const bucket = getBucket(c.env);
  if (!bucket) return unavailable(request, "runtime_r2_binding_unavailable");

  let before: Awaited<ReturnType<typeof readStrictManifest>>;
  try {
    before = await readStrictManifest(bucket);
  } catch {
    return unavailable(request, "public_visibility_manifest_unavailable");
  }
  if (isEntityBlockedInManifest(before.manifest, "event", eventId)) {
    return notFound(request);
  }

  let artifact: unknown;
  try {
    const object = await bucket.get(eventBaseObjectKey(eventId));
    if (!object) return unavailable(request, "public_data_unavailable");
    if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_BYTES) {
      await cancelR2BodyBestEffort(object);
      return unavailable(request, "public_data_unavailable");
    }
    artifact = await object.json();
  } catch {
    return unavailable(request, "public_data_unavailable");
  }

  const payload = normalizePublicEventStaffArtifact(
    filterPublicArtifactPayload(
      "event",
      artifact,
      buildPublicArtifactVisibilityContext(before.manifest),
    ),
    eventId,
  );
  if (!payload) return unavailable(request, "public_data_unavailable");

  let after: Awaited<ReturnType<typeof readStrictManifest>>;
  try {
    after = await readStrictManifest(bucket);
  } catch {
    return unavailable(request, "public_visibility_manifest_unavailable");
  }
  if (isEntityBlockedInManifest(after.manifest, "event", eventId)) {
    return notFound(request);
  }
  if (after.etag !== before.etag) {
    return unavailable(request, "public_visibility_manifest_changed");
  }

  try {
    assertNoForbiddenKeys(payload);
  } catch {
    return unavailable(request, "public_payload_unavailable");
  }
  // CURRENT calls publicJsonResponse, so a matching request ETag can return 304.
  return withCors(request, await publicJsonResponse(request, payload, SUCCESS_CACHE_CONTROL));
});
