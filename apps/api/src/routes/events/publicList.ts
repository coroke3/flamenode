import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  MAX_PUBLIC_EVENT_LIMIT,
  PUBLIC_EVENT_KEYS,
  type PublicEventDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@flamenode/server-core/publicData/publicDto";
import {
  checkPublicApiRateLimit,
  parseBoundedPositiveInt,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@flamenode/server-core/publicData/publicApi";
import { normalizeStaticEventsIndex } from "@flamenode/server-core/publicData/eventsIndexCore";
import { resolvePublicOperationMode } from "../live/operationMode.ts";
import { loadPublicSnapshot } from "../../lib/publicSnapshot.ts";

export const publicListRoutes = new Hono<AppEnv>();

const CACHE_CONTROL = "public, max-age=60, s-maxage=120, stale-while-revalidate=300";

publicListRoutes.get("/", async (c) => {
  const limited = checkPublicApiRateLimit(c.req.raw, "/api/events");
  if (limited) return limited;

  const page = parseBoundedPositiveInt(c.req.query("page"), 1);
  const limit = parseBoundedPositiveInt(
    c.req.query("limit"),
    60,
    MAX_PUBLIC_EVENT_LIMIT,
  );

  const mode = await resolvePublicOperationMode(c.env, { allowD1: false });
  if (mode === "maintenance") {
    return publicServiceUnavailableResponse("public_data_unavailable");
  }

  if (mode === "static_only") {
    const snapshot = await loadPublicSnapshot({
      bucket: c.env.BUCKET,
      key: "events/index.json",
      targetType: "events_index",
      guardModeRaw: c.env.PUBLIC_VISIBILITY_GUARD_MODE,
    });

    if (snapshot.kind !== "ok") {
      return publicServiceUnavailableResponse("public_data_unavailable");
    }

    const index = normalizeStaticEventsIndex(snapshot.data as any);
    if (!index || index.events.length === 0) {
      return publicServiceUnavailableResponse("public_data_unavailable");
    }

    const offset = (page - 1) * limit;
    const items: PublicEventDto[] = index.events
      .slice(offset, offset + limit)
      .map((row) => pickKeys(row as any, PUBLIC_EVENT_KEYS) as PublicEventDto);

    const payload = { items, page, limit };
    assertNoForbiddenKeys(payload);
    return publicJsonResponse(c.req.raw, payload, CACHE_CONTROL);
  }

  // Live mode: normal / economy / read_only -> D1 statement (L4)
  if (!c.env.DB) {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  const offset = (page - 1) * limit;
  let rows: any[];
  try {
    const result = await c.env.DB
      .prepare(
        `SELECT id, title, event_type, explanation, icon_url, img_url, accent_color,
                visibility_status, entry_start_time, entry_end_time, slot_type,
                slot_visibility_mode, start_time, end_time, max_slots_per_video
         FROM events
         WHERE visibility_status = 'public'
         ORDER BY start_time DESC, created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all();
    rows = result.results ?? [];
  } catch {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  const items: PublicEventDto[] = rows.map(
    (row) => pickKeys(row, PUBLIC_EVENT_KEYS) as PublicEventDto,
  );
  const payload = { items, page, limit };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(c.req.raw, payload, CACHE_CONTROL);
});
