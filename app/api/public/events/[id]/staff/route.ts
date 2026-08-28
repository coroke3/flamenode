import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  checkPublicApiRateLimit,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";
import { assertNoForbiddenKeys } from "@/lib/api/publicDto";
import {
  normalizePublicEventStaffArtifact,
  parsePublicEventId,
  resolvePvsfPublicApiOrigin,
} from "@/lib/api/publicEventStaff";
import { eventBaseObjectKey } from "@/lib/publicData/staticEventDetailCore";
import {
  buildPublicArtifactVisibilityContext,
  filterPublicArtifactPayload,
} from "@/lib/publicData/publicArtifactVisibility";
import { readPublicVisibilityBlockedEntitiesManifest } from "@/lib/publicData/publicVisibilityManifest";
import { isEntityBlockedInManifest } from "@/lib/publicData/publicVisibilityManifestCore";
import { cancelR2BodyBestEffort } from "@/lib/r2Body";

export const dynamic = "force-dynamic";

const PUBLIC_EVENT_STAFF_OBJECT_MAX_BYTES = 2 * 1024 * 1024;
const SUCCESS_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const ALLOWED_PREFLIGHT_HEADERS = new Set(["if-none-match"]);

type ReadableR2Bucket = Pick<R2Bucket, "get">;

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function withPvsfCors(request: Request, response: Response): Response {
  appendVary(response.headers, "Origin");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  const origin = request.headers.get("Origin");
  const allowedOrigin = resolvePvsfPublicApiOrigin(origin);
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Access-Control-Expose-Headers", "ETag, Retry-After");
  }
  return response;
}

function resolveR2BucketOnly(): ReadableR2Bucket | null {
  try {
    const bucket: unknown = getCloudflareContext().env.BUCKET;
    return bucket &&
      typeof bucket === "object" &&
      typeof (bucket as { get?: unknown }).get === "function"
      ? (bucket as ReadableR2Bucket)
      : null;
  } catch {
    return null;
  }
}

async function notFound(request: Request): Promise<Response> {
  return withPvsfCors(
    request,
    await publicJsonResponse(
      request,
      { error: "not_found" },
      "no-store",
      404,
    ),
  );
}

function unavailable(request: Request, code: string): Response {
  return withPvsfCors(request, publicServiceUnavailableResponse(code));
}

async function readStrictVisibilityManifest(bucket: ReadableR2Bucket) {
  const result = await readPublicVisibilityBlockedEntitiesManifest(
    bucket as R2Bucket,
  );
  if (!result.etag?.trim()) {
    throw new Error("public_visibility_manifest_missing");
  }
  return result;
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowedOrigin = resolvePvsfPublicApiOrigin(origin);
  const requestedMethod = request.headers
    .get("Access-Control-Request-Method")
    ?.toUpperCase();
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (
    !allowedOrigin ||
    (requestedMethod !== undefined &&
      requestedMethod !== "GET" &&
      requestedMethod !== "HEAD") ||
    requestedHeaders.some((header) => !ALLOWED_PREFLIGHT_HEADERS.has(header))
  ) {
    const denied = new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
    appendVary(denied.headers, "Access-Control-Request-Method");
    appendVary(denied.headers, "Access-Control-Request-Headers");
    return withPvsfCors(request, denied);
  }

  const response = new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "3600",
      "Cache-Control": "public, max-age=3600",
    },
  });
  appendVary(response.headers, "Access-Control-Request-Method");
  appendVary(response.headers, "Access-Control-Request-Headers");
  return withPvsfCors(request, response);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = checkPublicApiRateLimit(
    request,
    "/api/public/events/:id/staff",
  );
  if (limited) return withPvsfCors(request, limited);

  const eventId = parsePublicEventId((await params).id);
  if (!eventId) return notFound(request);

  const bucket = resolveR2BucketOnly();
  if (!bucket) {
    return unavailable(request, "runtime_r2_binding_unavailable");
  }

  let beforeManifest: Awaited<
    ReturnType<typeof readStrictVisibilityManifest>
  >;
  try {
    beforeManifest = await readStrictVisibilityManifest(bucket);
  } catch {
    return unavailable(request, "public_visibility_manifest_unavailable");
  }
  if (
    isEntityBlockedInManifest(beforeManifest.manifest, "event", eventId)
  ) {
    return notFound(request);
  }
  // Staff rows are part of the event-base artifact, but an X-user fence can
  // be published independently of the event fence. Apply the same payload
  // projection used by public artifact loaders before the DTO allowlist so a
  // stale base artifact cannot re-expose a blocked staff identity.
  const visibilityContext = buildPublicArtifactVisibilityContext(
    beforeManifest.manifest,
  );

  let rawArtifact: unknown;
  try {
    const object = await bucket.get(eventBaseObjectKey(eventId));
    if (!object) return unavailable(request, "public_data_unavailable");
    if (
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > PUBLIC_EVENT_STAFF_OBJECT_MAX_BYTES
    ) {
      await cancelR2BodyBestEffort(object);
      return unavailable(request, "public_data_unavailable");
    }
    rawArtifact = await object.json();
  } catch {
    return unavailable(request, "public_data_unavailable");
  }

  const payload = normalizePublicEventStaffArtifact(
    filterPublicArtifactPayload("event", rawArtifact, visibilityContext),
    eventId,
  );
  if (!payload) return unavailable(request, "public_data_unavailable");

  // Re-read the commit-point object after the staff artifact. A fence inserted
  // between the first manifest read and the artifact read must win this race.
  let afterManifest: Awaited<
    ReturnType<typeof readStrictVisibilityManifest>
  >;
  try {
    afterManifest = await readStrictVisibilityManifest(bucket);
  } catch {
    return unavailable(request, "public_visibility_manifest_unavailable");
  }
  if (isEntityBlockedInManifest(afterManifest.manifest, "event", eventId)) {
    return notFound(request);
  }
  if (afterManifest.etag !== beforeManifest.etag) {
    return unavailable(request, "public_visibility_manifest_changed");
  }

  try {
    assertNoForbiddenKeys(payload);
  } catch {
    return unavailable(request, "public_payload_unavailable");
  }

  return withPvsfCors(
    request,
    await publicJsonResponse(
      request,
      payload,
      SUCCESS_CACHE_CONTROL,
    ),
  );
}
