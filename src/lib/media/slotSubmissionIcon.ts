import type { FlameNodeEnv } from "../cloudflare.ts";
import {
  canActAsSlotActor,
  resolveSlotViewerRelation,
} from "../slots/slotIdentityCore.ts";
import {
  getPublicMediaNamespace,
  isPublicMediaObjectSafe,
  normalizePublicMediaContentType,
  PUBLIC_MEDIA_CACHE_CONTROL,
} from "./publicMedia.ts";

const SLOT_ID_RE =
  /^slot_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_CACHE_CONTROL = PUBLIC_MEDIA_CACHE_CONTROL;
const PRIVATE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate";
const MEDIA_UNAVAILABLE_HEADERS = {
  "cache-control": "no-store",
  "retry-after": "30",
};
const MEDIA_NOT_FOUND_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function mediaUnavailableResponse(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: MEDIA_UNAVAILABLE_HEADERS,
  });
}

function mediaNotFoundResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: MEDIA_NOT_FOUND_HEADERS,
  });
}

export function isValidSlotSubmissionIconSlotId(slotId: string): boolean {
  if (!slotId || slotId.includes("..") || slotId.includes("\\")) return false;
  if (/[\x00-\x1F\x7F]/.test(slotId)) return false;
  return SLOT_ID_RE.test(slotId);
}

/** 1 D1 query: slot + event visibility + submitted video icon。 */
export const SLOT_SUBMISSION_ICON_LOOKUP_SQL = `
SELECT
  s.status AS slot_status,
  s.reserved_by_user_id,
  s.x_user_id AS slot_x_user_id,
  e.slot_visibility_mode,
  e.visibility_status AS event_visibility_status,
  v.creator_icon_url
FROM slots s
INNER JOIN events e ON e.id = s.event_id
LEFT JOIN videos v ON v.id = s.video_id
WHERE s.id = ?1
LIMIT 1
`;

export type SlotSubmissionIconLookupRow = {
  slot_status: string;
  reserved_by_user_id: string | null;
  slot_x_user_id: string | null;
  slot_visibility_mode: string | null;
  event_visibility_status: string;
  creator_icon_url: string | null;
};

export type SlotSubmissionIconAccess =
  | { allowed: false }
  | {
      allowed: true;
      cacheControl: typeof PUBLIC_CACHE_CONTROL | typeof PRIVATE_CACHE_CONTROL;
      iconUrl: string;
    };

export function resolveSlotSubmissionIconAccess(
  row: SlotSubmissionIconLookupRow | null,
  viewer: { id: string; active_x_user_id: string | null } | null,
): SlotSubmissionIconAccess {
  if (!row) return { allowed: false };
  if (row.slot_status !== "submitted") return { allowed: false };
  if (row.event_visibility_status !== "public") return { allowed: false };
  const iconUrl = row.creator_icon_url?.trim() ?? "";
  if (!iconUrl) return { allowed: false };

  if (row.slot_visibility_mode === "public_name") {
    return {
      allowed: true,
      cacheControl: PUBLIC_CACHE_CONTROL,
      iconUrl,
    };
  }

  if (!viewer) return { allowed: false };

  const isReservationOwner = row.reserved_by_user_id === viewer.id;
  if (!isReservationOwner) {
    const relation = resolveSlotViewerRelation({
      reservedByUserId: row.reserved_by_user_id,
      slotXUserId: row.slot_x_user_id,
      authUserId: viewer.id,
      activeXId: viewer.active_x_user_id,
    });
    if (!canActAsSlotActor(relation)) return { allowed: false };
  }

  return {
    allowed: true,
    cacheControl: PRIVATE_CACHE_CONTROL,
    iconUrl,
  };
}

export type SlotSubmissionIconProbe =
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "public"; row: SlotSubmissionIconLookupRow }
  | { kind: "viewer_required"; row: SlotSubmissionIconLookupRow };

/**
 * Auth.jsより先に1回のD1 lookupだけで公開可否を判定する。
 * public_nameならviewer不要。private/anonymousだけroute側がAuth.jsを解決する。
 */
export async function probeSlotSubmissionIcon(
  env: Pick<FlameNodeEnv, "DB">,
  slotId: string,
): Promise<SlotSubmissionIconProbe> {
  if (!isValidSlotSubmissionIconSlotId(slotId)) return { kind: "not_found" };
  if (!env.DB) return { kind: "unavailable" };

  let row: SlotSubmissionIconLookupRow | null;
  try {
    row = await env.DB.prepare(SLOT_SUBMISSION_ICON_LOOKUP_SQL)
      .bind(slotId)
      .first<SlotSubmissionIconLookupRow>();
  } catch (error) {
    console.error("[slot-submission-icon] D1 lookup failed", error);
    return { kind: "unavailable" };
  }

  if (!row) return { kind: "not_found" };
  if (
    row.slot_status !== "submitted" ||
    row.event_visibility_status !== "public" ||
    !row.creator_icon_url?.trim()
  ) {
    return { kind: "not_found" };
  }
  return row.slot_visibility_mode === "public_name"
    ? { kind: "public", row }
    : { kind: "viewer_required", row };
}

function extractR2KeyFromMediaUrl(iconUrl: string): string | null {
  const prefix = "/api/media/";
  if (!iconUrl.startsWith(prefix)) return null;
  const key = iconUrl.slice(prefix.length);
  if (!key || key.includes("..") || key.includes("\\")) return null;
  if (/[\x00-\x1F\x7F]/.test(key)) return null;
  return key;
}

export async function serveSlotSubmissionIconRow(
  env: Pick<FlameNodeEnv, "BUCKET">,
  row: SlotSubmissionIconLookupRow,
  viewer: { id: string; active_x_user_id: string | null } | null,
): Promise<Response> {
  const access = resolveSlotSubmissionIconAccess(row, viewer);
  if (!access.allowed) return mediaNotFoundResponse();

  const { iconUrl, cacheControl } = access;
  if (iconUrl.startsWith("https://")) {
    return new Response(null, {
      status: 302,
      headers: {
        location: iconUrl,
        "cache-control": cacheControl,
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (iconUrl.startsWith("http://")) {
    return mediaNotFoundResponse();
  }

  const r2Key = extractR2KeyFromMediaUrl(iconUrl);
  if (!r2Key) return mediaNotFoundResponse();

  const namespace = getPublicMediaNamespace(r2Key);
  if (!namespace) return mediaNotFoundResponse();
  if (!env.BUCKET) {
    return mediaUnavailableResponse("Media storage unavailable");
  }

  let obj: R2ObjectBody | null;
  try {
    obj = await env.BUCKET.get(r2Key);
  } catch (error) {
    console.error("[slot-submission-icon] R2 read failed", error);
    return mediaUnavailableResponse("Media storage unavailable");
  }
  if (!obj) return mediaNotFoundResponse();

  const contentType = normalizePublicMediaContentType(obj.httpMetadata?.contentType);
  if (!contentType || !isPublicMediaObjectSafe({ size: obj.size, contentType })) {
    return mediaNotFoundResponse();
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", cacheControl);
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}

/** Backward-compatible helper for tests/internal callers. */
export async function serveSlotSubmissionIcon(
  env: Pick<FlameNodeEnv, "DB" | "BUCKET">,
  slotId: string,
  viewer: { id: string; active_x_user_id: string | null } | null,
): Promise<Response> {
  const probe = await probeSlotSubmissionIcon(env, slotId);
  if (probe.kind === "unavailable") {
    return mediaUnavailableResponse("Media access check unavailable");
  }
  if (probe.kind === "not_found") {
    return mediaNotFoundResponse();
  }
  return serveSlotSubmissionIconRow(env, probe.row, viewer);
}
