/**
 * MIG-0654 U02: staff create/update/delete (SA-031/033).
 * Parent Manage router provides Origin -> session -> writeGuard -> D1.
 * The authoritative owner/self/CAS/audit rules remain in server-core.
 * No production route switch, remote database or Next.js action changes.
 */
import type { Hono } from "hono";
import {
  EventStaffDeleteBodySchema,
  EventStaffUpsertBodySchema,
} from "@flamenode/contracts";
import {
  canonicalizePermissionKey,
  isAdminOnlyKey,
  normalizePermissionKeys,
} from "@flamenode/domain/auth/permissions";
import { parseEventStaffPermissionKeys } from "@flamenode/domain/event";
import { parseCanonicalXId } from "@flamenode/domain/xid";
import {
  assertActorMayAssignOwner,
  createEventStaffWithProtection,
  deleteEventStaffWithProtection,
  updateEventStaffWithProtection,
  type EventStaffRow,
  type EventStaffAtomicExtras,
  LAST_OWNER_ERROR,
} from "@flamenode/server-core/event/eventOwnership";
import { generateId } from "@flamenode/server-core/id";
import { sql } from "@flamenode/server-core/sql";
import { enqueueStaticRebuildMany } from "@flamenode/server-core/staticRebuild/enqueue";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { canEditEvent, loadManageSnapshot } from "./access.ts";

const VALID_EVENT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_STAFF_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const GENERIC_FAILURE = "スタッフ情報の取得・保存に失敗しました。再読み込みしてお試しください。";
const NO_STORE = "private, no-store";

type UpsertBody = ReturnType<typeof EventStaffUpsertBodySchema.parse>;
type Caller = { id: string; role: string | null };
type StaffContext = { eventId: string; user: Caller };

function deny(c: import("hono").Context<AppEnv>, message: string, status: 400 | 403 | 404 | 409 | 413 | 503) {
  return c.json({ ok: false, message }, status);
}


async function permitted(c: import("hono").Context<AppEnv>): Promise<StaffContext | Response> {
  const user = c.get("user");
  if (!user) return deny(c, "ログインが必要です。", 403);
  const eventId = c.req.param("id") ?? "";
  if (!VALID_EVENT_ID.test(eventId)) return deny(c, "イベントIDが不正です。", 400);
  try {
    const snapshot = await loadManageSnapshot(c.env.DB, user);
    if (snapshot.rowsTruncated) return deny(c, GENERIC_FAILURE, 503);
    if (!canEditEvent(snapshot, eventId, "event.members")) {
      return deny(c, "このイベントのスタッフを管理する権限がありません。", 403);
    }
    return { eventId, user };
  } catch {
    console.error("[MIG-0654] staff permission read failed");
    return deny(c, GENERIC_FAILURE, 503);
  }
}

function assignment(data: UpsertBody, isSiteAdmin: boolean) {
  if (data.permission_preset === "xid_reviewer" && !isSiteAdmin) {
    throw new Error("X ID確認権限は site admin 専用です。");
  }
  if (data.permission_preset !== "custom") {
    return { permission_preset: data.permission_preset, custom_permission_keys_json: null };
  }
  const raw = parseEventStaffPermissionKeys(data.permission_keys);
  if (!isSiteAdmin && raw.some((key) => {
    const canonical = canonicalizePermissionKey(key);
    return canonical !== null && isAdminOnlyKey(canonical);
  })) {
    throw new Error("site admin 専用権限は付与できません。");
  }
  const keys = normalizePermissionKeys(raw, { allowAdminOnly: isSiteAdmin });
  return {
    permission_preset: keys.length ? "custom" as const : "public_staff" as const,
    custom_permission_keys_json: keys.length ? JSON.stringify(keys) : null,
  };
}

// Guarded known CURRENT domain failures may be shown; never expose a SQL, D1,
// provider or internal stack trace in an HTTP response.
function domainMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message === LAST_OWNER_ERROR) return error.message;
  if (/^(同じX ID|代表権限|イベント代表者|自分自身|確認|X ID確認権限|site admin 専用権限|owner を付与|イベントスタッフ)/.test(error.message)) {
    return error.message;
  }
  return null;
}

async function queueProjection(c: import("hono").Context<AppEnv>, ctx: StaffContext, reason: string, includeUsers: boolean) {
  // CURRENT performs post-commit best-effort projection. Hono has no Queue binding
  // here: persist the same D1 intent; polling recovers the wake (D-15-6).
  await enqueueStaticRebuildMany(c.get("db"), [
    { targetType: "event_base", targetId: ctx.eventId, reason, priority: "high", requestedByUserId: ctx.user.id },
    { targetType: "event_slots", targetId: ctx.eventId, reason, priority: "high", requestedByUserId: ctx.user.id },
    { targetType: "events_index", targetId: "global", reason, priority: "low", requestedByUserId: ctx.user.id },
    { targetType: "member_suggestions", targetId: "global", reason, priority: "low" },
    ...(includeUsers ? [{ targetType: "users_index" as const, targetId: "global", reason, priority: "low" as const, requestedByUserId: ctx.user.id }] : []),
  ], { wakeSource: "web" }, async () => ({
    readEnv: () => null,
    readWaitUntil: () => null,
    readKv: () => null,
  }));
}

/** Shared POST / and PUT /:staffId; a PUT can never silently create a missing row. */
async function upsert(c: import("hono").Context<AppEnv>, targetId: string | null) {
  c.header("Cache-Control", NO_STORE);
  const request = await readAdminJsonBody(c.req.raw);
  if (request.kind === "too_large") return deny(c, BODY_TOO_LARGE_MESSAGE, 413);
  if (request.kind !== "ok") return deny(c, "入力エラー", 400);
  const parsed = EventStaffUpsertBodySchema.safeParse(request.value);
  if (!parsed.success) return deny(c, parsed.error.issues[0]?.message ?? "入力エラー", 400);
  if (parsed.data.staff_id && parsed.data.staff_id !== targetId) {
    return deny(c, "スタッフIDが一致しません。", 400);
  }
  const xId = parseCanonicalXId(parsed.data.x_user_id);
  if (!xId) return deny(c, "X IDが不正です", 400);
  const access = await permitted(c);
  if (access instanceof Response) return access;
  try {
    const isAdmin = access.user.role === "admin";
    const a = assignment(parsed.data, isAdmin);
    // Authorization is done before any private staff/X-user record is read.
    // Bounded legacy scan prevents two differently formatted rows from creating
    // duplicate canonical X identities. Fail closed when coverage is incomplete.
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM event_staff WHERE event_id = ? LIMIT 101",
    ).bind(access.eventId).all<EventStaffRow>();
    if (results.length > 100) return deny(c, GENERIC_FAILURE, 503);
    const matches = results.filter((r) => parseCanonicalXId(r.x_user_id) === xId);
    if (matches.length > 1) return deny(c, "同じX IDを指す既存スタッフ行が複数あります。", 409);
    const existing = targetId
      ? results.find((r) => r.id === targetId)
      : matches[0];
    if (targetId && !existing) return deny(c, "スタッフが見つかりません。", 404);
    if (existing && !VALID_STAFF_ID.test(existing.id)) return deny(c, GENERIC_FAILURE, 503);
    if (a.permission_preset === "owner" && existing?.permission_preset !== "owner") {
      await assertActorMayAssignOwner({ db: c.get("db"), eventId: access.eventId,
        actorUserId: access.user.id, isSiteAdmin: isAdmin });
    }
    const userExists = await c.env.DB.prepare(
      "SELECT id FROM x_users WHERE id = ? LIMIT 1",
    ).bind(xId).first<{ id: string }>();
    const extras: EventStaffAtomicExtras | undefined = userExists ? undefined : {
      mutationStatements: [c.get("db").run(sql`
        INSERT INTO x_users (id, x_name, approval_status)
        VALUES (${xId}, ${parsed.data.display_name}, 'pending')
      `)],
      expectedMutationChanges: [1],
      audits: [{
        table_name: "x_users", target_id: xId, operation: "CREATE",
        before: null, after: { id: xId, x_name: parsed.data.display_name, approval_status: "pending" },
        actor_user_id: access.user.id, reason: "イベントスタッフ登録に伴う X ID 作成",
        context: "event-staff-admin", retention_class: "long_audit",
        restore_strategy: "delete_created", strict: true,
      }],
    };
    const values = {
      x_user_id: xId,
      display_name: parsed.data.display_name,
      permission_preset: a.permission_preset,
      custom_permission_keys_json: a.custom_permission_keys_json,
      is_public: parsed.data.is_public,
      public_role_label: parsed.data.public_role_label ?? null,
    };
    const now = Math.floor(Date.now() / 1000);
    if (existing) {
      await updateEventStaffWithProtection({
        db: c.get("db"), existing, values, actorUserId: access.user.id,
        reason: parsed.data.reason, confirmText: parsed.data.confirm_text,
        context: "event-staff-admin", now, atomicExtras: extras,
      });
    } else {
      await createEventStaffWithProtection({
        db: c.get("db"), id: generateId("es"), eventId: access.eventId, values,
        actorUserId: access.user.id, reason: parsed.data.reason,
        context: "event-staff-admin", now, atomicExtras: extras,
      });
    }
    await queueProjection(c, access, parsed.data.reason, Boolean(extras));
    return c.json({ ok: true, pendingPublicReflection: true }, 200);
  } catch (error) {
    const message = domainMessage(error);
    if (message) return deny(c, message, 409);
    console.error("[MIG-0654] staff upsert unavailable");
    return deny(c, GENERIC_FAILURE, 503);
  }
}

export function registerStaffWriteRoutes(app: Hono<AppEnv>): void {
  // Register directly on the parent: its Origin/session/writeGuard/DB stack
  // must wrap these exact canonical paths, not an unmatched nested subrouter.
  const base = "/events/:id/staff";
  // GET /events/:id/staff remains a read: never impose a write CostGuard on it.
  app.use(base, onlyMutating(costGuardMiddleware("manage_event_staff")));
  app.use(`${base}/:staffId`, onlyMutating(costGuardMiddleware("manage_event_staff")));
  app.post(base, (c) => upsert(c, null));
  app.put(`${base}/:staffId`, (c) => {
  const id = c.req.param("staffId") ?? "";
  if (!VALID_STAFF_ID.test(id)) return deny(c, "スタッフIDが不正です。", 400);
  return upsert(c, id);
});

app.delete(`${base}/:staffId`, async (c) => {
  c.header("Cache-Control", NO_STORE);
  const staffId = c.req.param("staffId") ?? "";
  if (!VALID_STAFF_ID.test(staffId)) return deny(c, "スタッフIDが不正です。", 400);
  const request = await readAdminJsonBody(c.req.raw);
  if (request.kind === "too_large") return deny(c, BODY_TOO_LARGE_MESSAGE, 413);
  if (request.kind !== "ok") return deny(c, "入力エラー", 400);
  const parsed = EventStaffDeleteBodySchema.safeParse(request.value);
  if (!parsed.success) return deny(c, parsed.error.issues[0]?.message ?? "入力エラー", 400);
  const access = await permitted(c);
  if (access instanceof Response) return access;
  try {
    const existing = await c.env.DB.prepare(
      "SELECT * FROM event_staff WHERE event_id = ? AND id = ? LIMIT 1",
    ).bind(access.eventId, staffId).first<EventStaffRow>();
    if (!existing) return c.json({ ok: true }, 200);
    await deleteEventStaffWithProtection({
      db: c.get("db"), existing, actorUserId: access.user.id,
      reason: parsed.data.reason, confirmText: parsed.data.confirm_text,
      context: "event-staff-admin",
    });
    await queueProjection(c, access, parsed.data.reason, false);
    return c.json({ ok: true, pendingPublicReflection: true }, 200);
  } catch (error) {
    const message = domainMessage(error);
    if (message) return deny(c, message, 409);
    console.error("[MIG-0654] staff delete unavailable");
    return deny(c, GENERIC_FAILURE, 503);
  }
});
}
