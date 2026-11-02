/**
 * MIG-0642 U03 (SA-045..048): notification outbox admin writes on Hono.
 * CURRENT: src/lib/actions/notification-admin.ts (feature `admin_notifications`).
 *   SA-045 POST /:id/retry          SA-046 POST /:id/cancel
 *   SA-047 POST /:id/force-resend   SA-048 POST /retry-failed
 * Every path reads the outbox row(s) once, then writes full-row CAS UPDATE (or
 * the forced INSERT) + strict audit in one D1 batch. D-0603-1 / D-13-41:
 * CURRENT wakes the notification Queue after retry / force-resend / retry-failed;
 * this Worker never wakes (DOCUMENTED DIFFERENCE: Cron drains the pending rows,
 * wake count CURRENT n -> Hono 0). Next revalidatePath has no Hono equivalent.
 */
import {
  decideNotificationCancel,
  isTerminalNotificationFailure,
  notificationCancelPatch,
  notificationRetryPatch,
  TERMINAL_NOTIFICATION_FAILURE_STATUSES,
} from "@flamenode/domain/admin";
import {
  AdminNotificationCancelBodySchema,
  type AdminTermsNotificationsResult,
} from "@flamenode/contracts";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { sql } from "@flamenode/server-core/sql";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

export const NOTIFICATION_CONFLICT_MESSAGE = "通知更新が競合したか監査記録に失敗しました。";
export const BULK_RETRY_MAX = 10;

// Drizzle column order of packages/db schema `notification_outbox`; the order
// is part of the audit before/after JSON bytes.
export const NOTIFICATION_OUTBOX_COLUMNS = [
  "id",
  "recipient_user_id",
  "type",
  "payload_json",
  "delivery_route",
  "correlation_id",
  "status",
  "attempt_count",
  "processing_started_at",
  "lease_token",
  "lease_expires_at",
  "next_attempt_at",
  "last_error",
  "processed_at",
  "event_id",
  "dedupe_key",
  "created_at",
] as const;
const COLUMN_LIST = NOTIFICATION_OUTBOX_COLUMNS.map((column) => `"${column}"`).join(", ");

type OutboxRow = Record<(typeof NOTIFICATION_OUTBOX_COLUMNS)[number], unknown> & {
  id: string;
  status: string | null;
  recipient_user_id: string | null;
  type: string;
  payload_json: string;
  delivery_route: string | null;
  correlation_id: string | null;
  event_id: string | null;
  dedupe_key: string | null;
};

type Status = 200 | 400 | 404 | 409 | 413;
const respond = (c: Context<AppEnv>, status: Status, body: AdminTermsNotificationsResult) =>
  c.json(body, status);

function setClause(values: Record<string, unknown>) {
  return sql.join(
    Object.entries(values).map(
      ([key, value]) => sql`${sql.raw('"' + key.replaceAll('"', '""') + '"')} = ${value}`,
    ),
    sql`, `,
  );
}

async function updateRows(
  c: Context<AppEnv>,
  rows: OutboxRow[],
  kind: "retry" | "cancel",
  reason?: string,
): Promise<boolean> {
  const db = c.get("db");
  const actor = c.get("user")!.id;
  const now = Math.floor(Date.now() / 1000);
  const statements = [];
  const audits: WriteAuditLogInput[] = [];
  for (const before of rows) {
    const patch = kind === "retry" ? notificationRetryPatch(now) : notificationCancelPatch(now, reason);
    statements.push(
      db.run(sql`
        UPDATE notification_outbox SET ${setClause(patch)}
        WHERE id = ${before.id} AND ${expectedRowCondition({ expectedCurrent: { ...before } })}
      `),
    );
    audits.push({
      table_name: "notification_outbox",
      target_id: before.id,
      operation: "UPDATE",
      before: { ...before },
      after: { ...before, ...patch },
      actor_user_id: actor,
      context: `admin_notification_${kind}`,
      reason: reason || (kind === "retry" ? "手動リトライ" : "手動キャンセル"),
      retention_class: "normal",
      strict: true,
    });
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: rows.map(() => 1),
      preloaded: auditPreloaded(c),
      audits,
    });
    return true;
  } catch {
    // Do not log provider exception text (may carry SQL or secrets).
    console.error("[notification-admin] atomic mutation failed");
    return false;
  }
}

async function loadRow(c: Context<AppEnv>, id: string): Promise<OutboxRow | null> {
  return c.env.DB
    .prepare(`SELECT ${COLUMN_LIST} FROM notification_outbox WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<OutboxRow>();
}

export const adminNotificationRoutes = new Hono<AppEnv>();

// Never let a failed preflight D1 read or a late binding getter throw into Hono's
// default error handler. Keep the provider error out of logs and responses.
adminNotificationRoutes.onError((_error, c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json<AdminTermsNotificationsResult>(
    { ok: false, message: "管理操作を処理できませんでした。再度お試しください。" },
    503,
  );
});
adminNotificationRoutes.use("*", onlyMutating(costGuardMiddleware("admin_notifications")));

// SA-048 retryAllFailedNotifications (declared before `/:id/*`; distinct segment count)
adminNotificationRoutes.post("/retry-failed", async (c) => {
  const statuses = [...TERMINAL_NOTIFICATION_FAILURE_STATUSES];
  const { results } = await c.env.DB
    .prepare(
      `SELECT ${COLUMN_LIST} FROM notification_outbox
       WHERE status IN (${statuses.map(() => "?").join(", ")})
       ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(...statuses, BULK_RETRY_MAX + 1)
    .all<OutboxRow>();
  const targets = (results ?? []).slice(0, BULK_RETRY_MAX);
  if (targets.length === 0) {
    return respond(c, 200, { ok: true, message: "失敗通知はありません。", retried: 0 });
  }
  if (!(await updateRows(c, targets, "retry"))) {
    return respond(c, 409, { ok: false, message: NOTIFICATION_CONFLICT_MESSAGE });
  }
  return respond(c, 200, {
    ok: true,
    message: `${targets.length}件を配信待ちに戻しました。`,
    retried: targets.length,
  });
});

// SA-045 retryFailedNotification
adminNotificationRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id").trim();
  if (!id || id.length > 128) return respond(c, 400, { ok: false, message: "idが不正です。" });
  const row = await loadRow(c, id);
  if (!row) return respond(c, 404, { ok: false, message: "通知が見つかりません。" });
  if (!isTerminalNotificationFailure(row.status)) {
    return respond(c, 409, { ok: false, message: `status=${row.status}はリトライ対象外です。` });
  }
  if (!(await updateRows(c, [row], "retry"))) {
    return respond(c, 409, { ok: false, message: NOTIFICATION_CONFLICT_MESSAGE });
  }
  return respond(c, 200, { ok: true, message: "通知を配信待ちに戻しました。" });
});

// SA-046 cancelNotification
adminNotificationRoutes.post("/:id/cancel", async (c) => {
  const id = c.req.param("id").trim();
  // The body is optional (CURRENT `reason` defaults to "").
  let reason = "";
  if (c.req.raw.body) {
    const read = await readAdminJsonBody(c.req.raw);
    if (read.kind === "too_large") return respond(c, 413, { ok: false, message: BODY_TOO_LARGE_MESSAGE });
    const shape = read.kind === "ok" ? AdminNotificationCancelBodySchema.safeParse(read.value) : null;
    if (!shape || !shape.success) return respond(c, 400, { ok: false, message: "入力が不正です。" });
    reason = String(shape.data.reason ?? "").trim();
  }
  if (!id || id.length > 128 || reason.length > 500) {
    return respond(c, 400, { ok: false, message: "入力が不正です。" });
  }
  const row = await loadRow(c, id);
  if (!row) return respond(c, 404, { ok: false, message: "通知が見つかりません。" });
  const decision = decideNotificationCancel(row.status);
  // Re-send safe: an already terminal row is a success; an in-flight row can still be delivered.
  if (decision.kind === "already_terminal") return respond(c, 200, { ok: true, message: decision.message });
  if (decision.kind === "in_flight") return respond(c, 409, { ok: false, message: decision.message });
  if (!(await updateRows(c, [row], "cancel", reason))) {
    return respond(c, 409, { ok: false, message: NOTIFICATION_CONFLICT_MESSAGE });
  }
  return respond(c, 200, { ok: true, message: "通知をキャンセルしました。" });
});

const MAX_PAYLOAD_BYTES = 8 * 1024;
const OPS_WEBHOOK_TARGETS = ["account", "event", "system"];

/** CURRENT validateNotificationPayload (src/lib/notifications/format.ts), thrown as in prepareNotification. */
function assertForcePayload(type: string, payload: unknown): asserts payload is Record<string, unknown> {
  const fail = (reason: string): never => {
    throw new Error(`通知 payload が不正です: ${reason}`);
  };
  if (type.length === 0) fail("type が文字列ではありません");
  if (type.length > 64) fail("type が 64 文字を超えています");
  if (!/^[a-z0-9_]+$/i.test(type)) fail("type は英数と _ のみ使用可能です");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("payload はオブジェクトである必要があります");
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_PAYLOAD_BYTES) {
    fail(`payload が ${MAX_PAYLOAD_BYTES} バイトを超えています`);
  }
  const record = payload as Record<string, unknown>;
  const content = record.content;
  if (content !== undefined && typeof content !== "string") fail("payload.content は文字列である必要があります");
  if (typeof content === "string" && content.length > 2000) fail("payload.content は 2000 文字以内にしてください");
  const target = record.webhook_target;
  if (target !== undefined && !(typeof target === "string" && OPS_WEBHOOK_TARGETS.includes(target))) {
    fail("payload.webhook_target が不正です");
  }
  const threadName = record.thread_name;
  if (threadName !== undefined) {
    if (typeof threadName !== "string") fail("payload.thread_name は文字列である必要があります");
    if ((threadName as string).length > 100) fail("payload.thread_name は 100 文字以内にしてください");
  }
}

// SA-047 forceResendNotification
adminNotificationRoutes.post("/:id/force-resend", async (c) => {
  const id = c.req.param("id").trim();
  if (!id || id.length > 128) return respond(c, 400, { ok: false, message: "idが不正です。" });
  // The recipient existence check is folded into the source read (one D1 read).
  const found = await c.env.DB
    .prepare(
      `SELECT ${COLUMN_LIST},
         (SELECT 1 FROM "user" WHERE "user".id = notification_outbox.recipient_user_id) AS _recipient_exists
       FROM notification_outbox WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<OutboxRow & { _recipient_exists: number | null }>();
  if (!found) return respond(c, 404, { ok: false, message: "通知が見つかりません。" });
  const { _recipient_exists, ...source } = found;

  let payload: unknown;
  try {
    payload = JSON.parse(source.payload_json);
  } catch {
    return respond(c, 400, { ok: false, message: "payloadを解析できません。" });
  }

  try {
    assertForcePayload(source.type, payload);
  } catch (error) {
    console.error("[notification-admin] force-resend payload rejected");
    return respond(c, 400, { ok: false, message: error instanceof Error ? error.message : NOTIFICATION_CONFLICT_MESSAGE });
  }

  const deliveryRoute = source.delivery_route ?? (source.type === "discord_webhook" ? "channel" : "dm");
  const route = deliveryRoute === "channel" ? "channel" : "dm";
  // force=true: no dedupe pre-read, notification-disabled recipients are still resolved.
  const recipientUserId = source.recipient_user_id?.trim() && _recipient_exists ? source.recipient_user_id.trim() : null;
  if (route === "dm" && !recipientUserId) {
    return respond(c, 409, { ok: false, message: "宛先の通知設定がOFF、または再送通知を構築できません。" });
  }
  const now = Math.floor(Date.now() / 1000);
  const row = {
    id: crypto.randomUUID(),
    recipient_user_id: recipientUserId,
    type: source.type,
    payload_json: JSON.stringify(payload),
    delivery_route: route,
    correlation_id:
      typeof source.correlation_id === "string" && source.correlation_id.trim()
        ? source.correlation_id.trim().slice(0, 160)
        : null,
    status: "pending",
    attempt_count: 0,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error: null,
    processed_at: null,
    event_id: source.event_id ?? null,
    dedupe_key: `${source.dedupe_key || source.id}:force:${crypto.randomUUID()}`.trim() || null,
    created_at: now,
  };
  const db = c.get("db");
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO notification_outbox (${sql.raw(COLUMN_LIST)})
          VALUES (${sql.join(NOTIFICATION_OUTBOX_COLUMNS.map((column) => sql`${row[column]}`), sql`, `)})
          ON CONFLICT DO NOTHING
        `),
      ],
      expectedMutationChanges: [null],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "notification_outbox",
          target_id: row.id,
          operation: "CREATE",
          after: { ...row },
          actor_user_id: c.get("user")!.id,
          context: "admin_notification_force_resend",
          reason: `通知${source.id}を強制再送`,
          retention_class: "normal",
          strict: true,
        },
      ],
    });
  } catch {
    console.error("[notification-admin] atomic mutation failed");
    return respond(c, 409, { ok: false, message: NOTIFICATION_CONFLICT_MESSAGE });
  }
  return respond(c, 200, { ok: true, message: "通知を再送キューに追加しました。" });
});
