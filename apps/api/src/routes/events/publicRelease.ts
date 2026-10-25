import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  checkPublicApiRateLimit,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@flamenode/server-core/publicData/publicApi";
import {
  eventReleaseObjectKey,
  normalizeStaticEventRelease,
} from "@flamenode/server-core/publicData/eventReleaseCore";
import { resolvePublicOperationMode } from "../live/operationMode.ts";
import { loadPublicSnapshot } from "../../lib/publicSnapshot.ts";

export const publicReleaseRoutes = new Hono<AppEnv>();

const RELEASE_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=120";
const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";

function decodePathSegment(raw: string | undefined): string | null {
  try {
    const value = decodeURIComponent(raw ?? "").trim();
    return value.length > 0 && value.length <= 128 ? value : null;
  } catch {
    return null;
  }
}

publicReleaseRoutes.get("/:id/release", async (c) => {
  const limited = checkPublicApiRateLimit(c.req.raw, "/api/event-endpoints/:id/release");
  if (limited) return limited;

  const eventId = decodePathSegment(c.req.param("id"));
  if (!eventId) {
    return publicJsonResponse(c.req.raw, { error: "not_found" }, NOT_FOUND_CACHE_CONTROL, 404);
  }

  if (!c.env.DB) {
    return publicServiceUnavailableResponse("db_unavailable");
  }

  let eventRow: { id: string } | null = null;
  try {
    eventRow = await c.env.DB
      .prepare(
        "SELECT id FROM events WHERE id = ? AND visibility_status = 'public' AND public_api_enabled = 1 LIMIT 1",
      )
      .bind(eventId)
      .first<{ id: string }>();
  } catch {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  if (!eventRow) {
    return publicJsonResponse(c.req.raw, { error: "not_found" }, NOT_FOUND_CACHE_CONTROL, 404);
  }

  const mode = await resolvePublicOperationMode(c.env, { allowD1: false });
  if (mode === "maintenance") {
    return publicServiceUnavailableResponse("public_data_unavailable");
  }

  const key = eventReleaseObjectKey(eventId);
  const snapshot = await loadPublicSnapshot({
    bucket: c.env.BUCKET,
    key,
    targetType: "event_release",
    targetEntityId: eventId,
    guardModeRaw: c.env.PUBLIC_VISIBILITY_GUARD_MODE,
  });

  if (snapshot.kind === "not_found") {
    return publicJsonResponse(c.req.raw, { error: "not_found" }, NOT_FOUND_CACHE_CONTROL, 404);
  }
  if (snapshot.kind !== "ok") {
    return publicServiceUnavailableResponse("public_data_unavailable");
  }

  const release = normalizeStaticEventRelease(snapshot.data as any);
  if (!release || release.event.id !== eventId) {
    return publicServiceUnavailableResponse("public_data_unavailable");
  }

  return publicJsonResponse(c.req.raw, release, RELEASE_CACHE_CONTROL);
});
