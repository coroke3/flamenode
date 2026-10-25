/**
 * MIG-0602 U02: SA-007..008 API endpoint config on Hono.
 * CURRENT: src/lib/actions/api-endpoints.ts (createApiEndpoint /
 * setApiEndpointActive -> setPublicApi). Result bodies keep the CURRENT
 * ApiEndpointResult shape; HTTP status is added: validation 400 / event not
 * found 404 / not public 400 / mutation failure 500 (CURRENT message).
 * Mounted behind session -> writeGuard -> CostGuard ("admin_api_endpoints").
 */
import {
  type ApiEndpointResult,
  validateApiEndpointEventId,
  validateEventForApiActivation,
} from "@flamenode/domain/apiEndpoints";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { sql } from "@flamenode/server-core/sql";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { MAX_SINGLE_ROW_LIMIT } from "../../lib/limits.ts";
import {
  ApiEndpointCreateBodySchema,
  ApiEndpointSetActiveBodySchema,
} from "@flamenode/contracts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";

export const API_ENDPOINT_FAILURE_MESSAGE =
  "更新が競合したか監査記録に失敗しました。";

// Drizzle select() column order of src/lib/db/schema.ts `events` (CURRENT).
// The order is part of the audit before/after JSON bytes; pinned against the
// real schema by apps/api/test/auditParity.test.mjs.
export const EVENT_COLUMNS = [
  "id", "title", "event_type", "explanation", "youtube_description_template",
  "required_video_fields_json", "icon_url", "img_url", "accent_color",
  "visibility_status", "allow_user_video_event_links", "allow_unslotted_posts",
  "allow_user_video_edits", "user_video_edit_permission_keys_json", "slot_type",
  "slot_visibility_mode", "start_time", "end_time", "entry_start_time",
  "entry_end_time", "created_at", "updated_at", "max_slots_per_video",
  "max_slot_reservation_groups_per_xid", "slot_interval_minutes",
  "review_settings", "editable_fields", "repeat_rules", "slot_part_gap_minutes",
  "parts_json", "public_api_enabled",
] as const;

type EventRow = Record<string, unknown> & {
  visibility_status: string;
  updated_at: number;
};

// src/lib/api/eventExportCache.ts + publicCache.ts (Cache API entries only).
const EVENT_EXPORT_CACHE_VERSION = 9;
const EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440] as const;
const PUBLIC_JSON_CACHE_ORIGIN = "https://flamenode.internal/public-json/";

/** src/lib/publicData/publicCache.ts publicJsonCacheKey(r2Key).url */
export function publicJsonCacheRequestUrl(r2Key: string): string {
  return `${PUBLIC_JSON_CACHE_ORIGIN}${encodeURIComponent(r2Key)}`;
}

export function eventExportCacheKeys(eventId: string): string[] {
  return (["v5", "legacy"] as const).flatMap((format) =>
    EVENT_EXPORT_REFRESH_MINUTES.map((minutes) =>
      [
        "public-event-export",
        EVENT_EXPORT_CACHE_VERSION,
        encodeURIComponent(eventId),
        format,
        minutes,
      ].join(":"),
    ),
  );
}

/** Best effort (CURRENT runPostCommitBestEffort): never fails the mutation. */
async function invalidateEventExportCache(eventId: string): Promise<void> {
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  for (const key of eventExportCacheKeys(eventId)) {
    try {
      await store?.delete(
        new Request(publicJsonCacheRequestUrl(key)),
      );
    } catch {
      // Cache API failure must not take down the mutation path.
    }
  }
}

function failure(
  c: { json: (b: unknown, s: 400 | 404 | 413 | 500) => Response },
  status: 400 | 404 | 413 | 500,
  message: string,
) {
  const body: ApiEndpointResult = { ok: false, message };
  return c.json(body, status);
}

async function setPublicApi(
  c: Context<AppEnv, any>,
  rawEventId: string,
  enabled: 0 | 1,
): Promise<Response> {
  const db = c.get("db");
  const userId = c.get("user")!.id;
  const validated = validateApiEndpointEventId(rawEventId);
  if (!validated.ok) return failure(c, 400, validated.message);
  const eventId = validated.eventId;

  let before: EventRow | null;
  try {
    before = await c.env.DB
      .prepare(
        `SELECT ${EVENT_COLUMNS.map((col) => `"${col}"`).join(", ")}
         FROM events WHERE id = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
      )
      .bind(eventId)
      .first<EventRow>();
  } catch (error) {
    console.error("[api-endpoints] preflight read failed", error);
    return failure(c, 500, API_ENDPOINT_FAILURE_MESSAGE);
  }
  const activationCheck = validateEventForApiActivation(before, enabled);
  if (!activationCheck.ok) {
    return failure(c, before ? 400 : 404, activationCheck.message);
  }
  const current = before!;

  const now = Math.max(Math.floor(Date.now() / 1000), current.updated_at + 1);
  const after = { ...current, public_api_enabled: enabled, updated_at: now };
  const condition = expectedRowCondition({ expectedCurrent: { ...current } });

  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`UPDATE events SET public_api_enabled = ${enabled}, updated_at = ${now} WHERE id = ${eventId} AND ${condition}`),
      ],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "events",
          target_id: eventId,
          operation: "UPDATE",
          before: { ...current },
          after: { ...after },
          actor_user_id: userId,
          context: "admin_api_endpoints",
          reason: enabled ? "公開APIリンクを発行" : "公開APIを無効化",
          retention_class: "long_audit",
        },
      ],
    });
  } catch (error) {
    console.error("[api-endpoints] atomic mutation failed", error);
    return failure(c, 500, API_ENDPOINT_FAILURE_MESSAGE);
  }

  await invalidateEventExportCache(eventId);
  const body: ApiEndpointResult = {
    ok: true,
    id: eventId,
    message: enabled
      ? "公開APIリンクを発行しました。"
      : "公開APIを無効化しました。",
  };
  return c.json(body, 200);
}

export const apiEndpointRoutes = new Hono<AppEnv>();
apiEndpointRoutes.use("*", onlyMutating(costGuardMiddleware("admin_api_endpoints")));

// SA-007 createApiEndpoint
apiEndpointRoutes.post("/", async (c) => {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") return failure(c, 413, BODY_TOO_LARGE_MESSAGE);
  const shape =
    read.kind === "ok" ? ApiEndpointCreateBodySchema.safeParse(read.value) : null;
  // CURRENT: String(formData.get("event_id") ?? "").trim(); a missing body
  // reaches validateApiEndpointEventId as "" -> "event_idが不正です。".
  const eventId = shape?.success ? String(shape.data.event_id ?? "").trim() : "";
  return setPublicApi(c, eventId, 1);
});

// SA-008 setApiEndpointActive
apiEndpointRoutes.patch("/:id", async (c) => {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") return failure(c, 413, BODY_TOO_LARGE_MESSAGE);
  const shape =
    read.kind === "ok"
      ? ApiEndpointSetActiveBodySchema.safeParse(read.value)
      : null;
  if (!shape || !shape.success) {
    return failure(c, 400, "public_api_enabledが不正です。");
  }
  return setPublicApi(c, c.req.param("id").trim(), shape.data.public_api_enabled);
});
