/**
 * MIG-0656 U02c-0: SA-064 complete label-write Hono candidate, UNMOUNTED.
 *
 * Parent router MUST put Origin -> session -> writeGuard -> dbMiddleware on
 * this path before mount. This module enforces manage_slot_update CostGuard,
 * approved linked event.slots permission, bounded JSON, 3-row CAS, strict
 * before/after audit and the durable slot-change projection queue in one D1
 * batch. Queue wake, full middleware replay and human review still gate mount.
 */
import { Hono } from "hono";
import { SlotBatchLabelsBodySchema } from "@flamenode/contracts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { resolveStaffPermissionKeys, type StaffPermissionRow } from "./access.ts";
import { selectSlotBatchRows } from "./slotWriteSelection.ts";
import { buildSlotBatchAtomicPlan } from "./slotWriteMutations.ts";
import { isWriteConflict } from "../events/templates.ts";

const NO_STORE = "private, no-store";
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "枠の更新に失敗しました。再読み込み後にお試しください。";

/** CURRENT typeof slots.$inferSelect: full snapshots, not list-view rows. */
const SLOT_COLUMNS = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
] as const;

export type SlotLabelWriteRow = {
  id: string;
  event_id: string;
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  reserved_x_id_snapshot: string | null;
  display_name: string | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number;
  reservation_group_id: string | null;
  video_id: string | null;
  status: string;
  updated_at: number;
  version: number;
};

/**
 * 1 D1 pre-read: event exists, approved linked staff grants (101 sentinel),
 * 4 slot-row sentinel and full audit snapshots. Together with writeGuard's
 * actor identity and CostGuard settings this fits the three-read S3 ceiling.
 */
export const SLOT_LABEL_WRITE_SNAPSHOT_SQL = `
  SELECT
    (SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,
    (SELECT json_group_array(json_object(
      'permission_preset', staff.permission_preset,
      'custom_permission_keys_json', staff.custom_permission_keys_json
    )) FROM (
      SELECT es.permission_preset, es.custom_permission_keys_json
      FROM event_staff es
      INNER JOIN x_user_account_links l ON l.x_user_id = es.x_user_id
      INNER JOIN x_users x ON x.id = l.x_user_id
      WHERE es.event_id = ? AND l.auth_user_id = ?
        AND x.approval_status = 'approved'
      LIMIT 101
    ) staff) AS staff_json,
    (SELECT json_group_array(json_object(
      ${SLOT_COLUMNS.map((name) => "'" + name + "', s.\"" + name + "\"").join(",\n      ")}
    )) FROM (
      SELECT s.* FROM slots s
      WHERE s.event_id = ? AND s.id IN
        (SELECT value FROM json_each(?))
      LIMIT 4
    ) s) AS slots_json
`;

function parseSlotRows(value: string | null): SlotLabelWriteRow[] {
  const parsed: unknown = JSON.parse(value ?? "[]");
  if (!Array.isArray(parsed) || parsed.length > 3 || parsed.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("slot_label_invalid_snapshot");
  }
  return parsed as SlotLabelWriteRow[];
}

function canUpdateEventLabels(
  role: string | null | undefined,
  rawGrants: string | null,
): boolean {
  const parsed: unknown = JSON.parse(rawGrants ?? "[]");
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error("slot_label_staff_rows_truncated");
  }
  if (role === "admin") return true;
  return parsed.some((item) => item && typeof item === "object" &&
    resolveStaffPermissionKeys(item as StaffPermissionRow).has("event.slots"));
}

/**
 * The parent index.ts intentionally does not mount this router while other
 * SA-056..063 handlers and post-commit queue wake integration are incomplete.
 */
export const slotBatchLabelWriteRoutes = new Hono<AppEnv>();
slotBatchLabelWriteRoutes.use("*", costGuardMiddleware("manage_slot_update"));
slotBatchLabelWriteRoutes.put("/batch-labels", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!EVENT_ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (body.kind !== "ok") {
    return c.json({ ok: false, message: "入力エラー" }, 400);
  }
  const parsed = SlotBatchLabelsBodySchema.safeParse(body.value);
  if (!parsed.success) return c.json({ ok: false, message: "入力エラー" }, 400);
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }

  try {
    const read = await c.env.DB.prepare(SLOT_LABEL_WRITE_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId, JSON.stringify(parsed.data.slot_ids))
      .first<{ exists_id: string | null; staff_json: string | null; slots_json: string | null }>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // Authorization precedes event-existence disclosure (404 for both).
    if (!canUpdateEventLabels(user.role, read.staff_json)) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    if (!read.exists_id) return c.json({ ok: false, message: "Not Found" }, 404);
    const current = parseSlotRows(read.slots_json);
    const selection = selectSlotBatchRows(eventId, parsed.data.slot_ids, current, "update-labels");
    if (!selection.ok) return c.json({ ok: false, message: selection.message }, 409);

    const now = Math.floor(Date.now() / 1000);
    const plan = buildSlotBatchAtomicPlan({
      kind: "update-labels", eventId, rows: selection.rows,
      updatedAt: now, label: parsed.data.label,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_label_update", requestedByUserId: user.id,
    });
    const audits = selection.rows.map((row) => ({
      table_name: "slots" as const, target_id: row.id,
      operation: "UPDATE" as const,
      before: { ...row },
      after: { ...row, slot_label: parsed.data.label, updated_at: now, version: row.version + 1 },
      actor_user_id: user.id,
      retention_class: "normal" as const, strict: true,
    }));
    await mutateWithAudit(db, {
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      preMutationAssertions: plan.preMutationAssertions.map((assertion) => db.run(assertion)),
      audits,
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true, message: String(selection.rows.length) + "件のラベルを更新しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] slot labels update failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
