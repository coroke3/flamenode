/**
 * MIG-0604 U02: RH-020..022 live event APIs on Hono.
 * CURRENT: app/api/live/events/[id]/{slots,submissions,summary}/route.ts ->
 * src/lib/staticRebuild/liveGuard.ts handleLiveApiGet + liveApi.ts.
 * Same contract: gate (id -> DB -> live_api_enabled per request) before the
 * 15s isolate micro-cache; only successful non-null bodies are cached;
 * success `Cache-Control: public, s-maxage=5, stale-while-revalidate=30`;
 * every error body is JSON with `Cache-Control: no-store`.
 * Raw D1 (no drizzle): read-only, <= 2 queries per uncached request.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { isolateMicroCacheGet, isolateMicroCacheSet } from "./microCache.ts";
import {
  isLiveApiEnabled,
  resolvePublicOperationMode,
  type OperationModeEnv,
} from "./operationMode.ts";

const MAX_EVENT_ID_LEN = 128;
/** 1 イベントあたりの live slots 取得上限（D1 負荷・レスポンス肥大化の防止） */
export const MAX_LIVE_SLOTS = 6000;
const ACTIVE_GRACE_AFTER_END_SEC = 86400;
export const LIVE_API_CACHE_CONTROL = "public, s-maxage=5, stale-while-revalidate=30";

function normalizeEventId(eventId: string): string | null {
  const id = eventId.trim();
  return id && id.length <= MAX_EVENT_ID_LEN ? id : null;
}

type LiveSlotVisibilityMode = "public_name" | "anonymous" | "hidden" | null;

/** CURRENT liveApiCore projectLiveSlotIdentity. */
export function projectLiveSlotIdentity(
  visibilityMode: LiveSlotVisibilityMode | string | null,
  publicVideoId: string | null,
  displayName: string | null,
): { video_id: string | null; display_name: string | null } {
  if (visibilityMode !== "public_name") return { video_id: null, display_name: null };
  return { video_id: publicVideoId, display_name: displayName };
}

type Loader = (db: D1Database, eventId: string) => Promise<unknown | null>;

export async function getLiveEventSummary(db: D1Database, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;
  const event = await db
    .prepare(
      `SELECT visibility_status, start_time, end_time FROM events
       WHERE id = ? AND visibility_status = 'public' LIMIT 1`,
    )
    .bind(id)
    .first<{ visibility_status: string | null; start_time: number | null; end_time: number | null }>();
  if (!event) return null;
  const counts = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN status = 'available' THEN 1 END) AS open_slots,
         COUNT(CASE WHEN status = 'reserved' THEN 1 END) AS reserved_slots,
         COUNT(CASE WHEN status = 'submitted' THEN 1 END) AS submitted
       FROM slots WHERE event_id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ open_slots: number; reserved_slots: number; submitted: number }>();
  const now = Math.floor(Date.now() / 1000);
  // Only public rows reach here (query filters), so freshness is end-based.
  const end = event.end_time ?? 0;
  const freshness = end && now > end + ACTIVE_GRACE_AFTER_END_SEC ? "ended" : "active";
  return {
    event_id: id,
    freshness,
    open_slots: Number(counts?.open_slots ?? 0),
    reserved_slots: Number(counts?.reserved_slots ?? 0),
    submitted: Number(counts?.submitted ?? 0),
    generated_at: now,
  };
}

export async function getLiveEventSlots(db: D1Database, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;
  const { results } = await db
    .prepare(
      `SELECT events.slot_visibility_mode AS slot_visibility_mode,
              slots.id AS id, slots.status AS status,
              videos.id AS public_video_id, slots.display_name AS display_name
       FROM events
       LEFT JOIN slots ON slots.event_id = events.id
       LEFT JOIN videos ON videos.id = slots.video_id AND videos.visibility_status = 'public'
       WHERE events.id = ? AND events.visibility_status = 'public'
       ORDER BY slots.start_time
       LIMIT ${MAX_LIVE_SLOTS}`,
    )
    .bind(id)
    .all<{
      slot_visibility_mode: string | null;
      id: string | null;
      status: string | null;
      public_video_id: string | null;
      display_name: string | null;
    }>();
  if (results.length === 0) return null;
  const slotRows = results.flatMap((row) =>
    row.id == null
      ? []
      : [
          {
            id: row.id,
            status: row.status!,
            ...projectLiveSlotIdentity(row.slot_visibility_mode, row.public_video_id, row.display_name),
          },
        ],
  );
  return {
    event_id: id,
    slots: slotRows,
    truncated: slotRows.length >= MAX_LIVE_SLOTS,
    generated_at: Math.floor(Date.now() / 1000),
  };
}

export async function getLiveEventSubmissions(db: D1Database, eventId: string) {
  const id = normalizeEventId(eventId);
  if (!id) return null;
  const { results } = await db
    .prepare(
      `SELECT videos.id AS video_id, videos.title AS title,
              videos.creator_display_name AS creator_display_name,
              videos.updated_at AS updated_at
       FROM events
       LEFT JOIN video_events ON video_events.event_id = events.id
       LEFT JOIN videos ON videos.id = video_events.video_id AND videos.visibility_status = 'public'
       WHERE events.id = ? AND events.visibility_status = 'public'
       ORDER BY videos.updated_at DESC
       LIMIT 50`,
    )
    .bind(id)
    .all<{
      video_id: string | null;
      title: string | null;
      creator_display_name: string | null;
      updated_at: number | null;
    }>();
  if (results.length === 0) return null;
  const submissions = results.flatMap((row) =>
    row.video_id == null
      ? []
      : [
          {
            video_id: row.video_id,
            title: row.title!,
            creator_display_name: row.creator_display_name!,
            updated_at: row.updated_at!,
          },
        ],
  );
  return { event_id: id, submissions, generated_at: Math.floor(Date.now() / 1000) };
}

function jsonError(error: string, message: string, status: 400 | 404 | 503): Response {
  return Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });
}

type LiveEnv = OperationModeEnv & { DB?: D1Database };

/** CURRENT handleLiveApiGet. */
export async function handleLiveApiGet(
  env: LiveEnv,
  eventId: string,
  load: Loader,
  routeName: string,
): Promise<Response> {
  const id = eventId.trim();
  if (!id || id.length > MAX_EVENT_ID_LEN) {
    return jsonError("invalid_event_id", "イベントIDが不正です。", 400);
  }
  const db = env.DB;
  if (!db) return jsonError("db_unavailable", "データベースに接続できません。", 503);
  try {
    const mode = await resolvePublicOperationMode(env, { allowD1: true });
    if (!isLiveApiEnabled(mode)) {
      return jsonError(
        "live_api_disabled",
        "ライブ更新 API は現在無効です（メンテナンスまたは静的配信モード）。",
        503,
      );
    }
    const microCacheKey = `live:${routeName}:${id}`;
    let body = isolateMicroCacheGet(microCacheKey);
    if (body === null) {
      const payload = await load(db, id);
      if (!payload) return jsonError("not_found", "イベントが見つかりません。", 404);
      body = JSON.stringify(payload);
      isolateMicroCacheSet(microCacheKey, body);
    }
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": LIVE_API_CACHE_CONTROL,
      },
    });
  } catch (err) {
    console.error("[live-api] GET failed", { eventId: id, err });
    return jsonError(
      "live_api_error",
      "ライブデータの取得に失敗しました。しばらくしてから再度お試しください。",
      503,
    );
  }
}

export const liveEventRoutes = new Hono<AppEnv>();

// RH-020
liveEventRoutes.get("/:id/slots", (c) =>
  handleLiveApiGet(c.env, c.req.param("id"), getLiveEventSlots, "slots"),
);
// RH-021
liveEventRoutes.get("/:id/submissions", (c) =>
  handleLiveApiGet(c.env, c.req.param("id"), getLiveEventSubmissions, "submissions"),
);
// RH-022
liveEventRoutes.get("/:id/summary", (c) =>
  handleLiveApiGet(c.env, c.req.param("id"), getLiveEventSummary, "summary"),
);
