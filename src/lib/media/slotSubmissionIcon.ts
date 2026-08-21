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
const PRIVATE_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate";
const MEDIA_UNAVAILABLE_HEADERS = {
  "cache-control": "no-store",
  "retry-after": "30",
};

function mediaUnavailableResponse(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: MEDIA_UNAVAILABLE_HEADERS,
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

  // Active X 切替で account_other になっても、確保した auth user 本人なら private 表示を許可
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

function extractR2KeyFromMediaUrl(iconUrl: string): string | null {
  const prefix = "/api/media/";
  if (!iconUrl.startsWith(prefix)) return null;
  const key = iconUrl.slice(prefix.length);
  if (!key || key.includes("..") || key.includes("\\")) return null;
  if (/[\x00-\x1F\x7F]/.test(key)) return null;
  return key;
}

export async function serveSlotSubmissionIcon(
  env: Pick<FlameNodeEnv, "DB" | "BUCKET">,
  slotId: string,
  viewer: { id: string; active_x_user_id: string | null } | null,
): Promise<Response> {
  if (!isValidSlotSubmissionIconSlotId(slotId)) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.DB) {
    return new Response("Media access check unavailable", { status: 503 });
  }

  let row: SlotSubmissionIconLookupRow | null = null;
  try {
    row = await env.DB.prepare(SLOT_SUBMISSION_ICON_LOOKUP_SQL)
      .bind(slotId)
      .first<SlotSubmissionIconLookupRow>();
  } catch (error) {
    console.error("[slot-submission-icon] D1 lookup failed", error);
    return mediaUnavailableResponse("Media access check unavailable");
  }

  const access = resolveSlotSubmissionIconAccess(row, viewer);
  if (!access.allowed) return new Response("Not found", { status: 404 });

  const { iconUrl, cacheControl } = access;
  if (iconUrl.startsWith("https://")) {
    // Keep the ACL-derived cache policy on redirects as well as R2 responses.
    // A private slot must not leave its external icon URL in an intermediary
    // cache that could serve it after the viewer authorization has changed.
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
    return new Response("Not found", { status: 404 });
  }

  const r2Key = extractR2KeyFromMediaUrl(iconUrl);
  if (!r2Key) return new Response("Not found", { status: 404 });

  const namespace = getPublicMediaNamespace(r2Key);
  if (!namespace) return new Response("Not found", { status: 404 });
  if (!env.BUCKET) {
    return new Response("Storage not configured", { status: 500 });
  }

  let obj: R2ObjectBody | null;
  try {
    obj = await env.BUCKET.get(r2Key);
  } catch (error) {
    console.error("[slot-submission-icon] R2 read failed", error);
    return mediaUnavailableResponse("Media storage unavailable");
  }
  if (!obj) return new Response("Not found", { status: 404 });

  const contentType = normalizePublicMediaContentType(obj.httpMetadata?.contentType);
  if (!contentType || !isPublicMediaObjectSafe({ size: obj.size, contentType })) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", cacheControl);
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}
