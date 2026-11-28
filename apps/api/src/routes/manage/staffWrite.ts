/**
 * MIG-0654 U02: staff create/update/delete (SA-031/033).
 * Parent Manage router provides Origin -> session -> writeGuard -> D1.
 * The authoritative owner/self/CAS/audit rules remain in server-core.
 * No production route switch, remote database or Next.js action changes.
 */
import type { Hono } from "hono";
import {
  EventStaffCsvBodySchema,
  EventStaffDeleteBodySchema,
  EventOwnerTransferBodySchema,
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
  bulkUpsertEventStaffWithProtection,
  createEventStaffWithProtection,
  deleteEventStaffWithProtection,
  updateEventStaffWithProtection,
  type EventStaffRow,
  type EventStaffAtomicExtras,
  type EventStaffBulkAtomicExtras,
  LAST_OWNER_ERROR,
  transferEventOwnership,
} from "@flamenode/server-core/event/eventOwnership";
import { generateId } from "@flamenode/server-core/id";
import { planD1AuditMutationBudget } from "@flamenode/server-core/audit/mutateBudget";
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
    staffDiagnostic("[MIG-0654] staff permission read failed");
    return deny(c, GENERIC_FAILURE, 503);
  }
}

function parseStaffPermissionInput(raw: string | null | undefined):
  { ok: true; keys: string[] } | { ok: false; message: string } {
  try {
    return { ok: true, keys: parseEventStaffPermissionKeys(raw) };
  } catch {
    // This catch surrounds only the pure domain input parser, never D1.
    // Build the bounded CURRENT message from the validated request, not
    // from error.message, and never allow it in the mutation error matcher.
    const invalid = raw && raw.length <= 512
      ? raw.split(",").map((key) => key.trim()).find((key) => key && !canonicalizePermissionKey(key))
      : null;
    return { ok: false, message: invalid && invalid.length <= 100
      ? `不正な権限キーです: ${invalid}` : "入力エラー" };
  }
}

function assignment(data: UpsertBody, raw: readonly string[], isSiteAdmin: boolean) {
  if (data.permission_preset === "xid_reviewer" && !isSiteAdmin) {
    throw new Error("X ID確認権限は site admin 専用です。");
  }
  if (data.permission_preset !== "custom") {
    return { permission_preset: data.permission_preset, custom_permission_keys_json: null };
  }
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

function assignmentFromCsv(
  preset: UpsertBody["permission_preset"],
  keys: readonly string[],
  isSiteAdmin: boolean,
) {
  if (preset === "xid_reviewer" && !isSiteAdmin) {
    throw new Error("X ID確認権限は site admin 専用です。");
  }
  if (preset !== "custom") {
    return { permission_preset: preset, custom_permission_keys_json: null };
  }
  if (!isSiteAdmin && keys.some((key) => {
    const canonical = canonicalizePermissionKey(key);
    return canonical !== null && isAdminOnlyKey(canonical);
  })) {
    throw new Error("site admin 専用権限は付与できません。");
  }
  const normalized = normalizePermissionKeys(keys, { allowAdminOnly: isSiteAdmin });
  return {
    permission_preset: normalized.length ? "custom" as const : "public_staff" as const,
    custom_permission_keys_json: normalized.length ? JSON.stringify(normalized) : null,
  };
}

// SEC-800: mirror CURRENT's exact fixed domain-message policy. Provider
// exceptions may contain arbitrary SQL/params; never reflect a prefix match.
const STAFF_SAFE_DOMAIN_MESSAGES = new Set([
  LAST_OWNER_ERROR,
  "X ID確認権限は site admin 専用です。",
  "site admin 専用権限は付与できません。",
  "同じX IDを指す既存スタッフ行が複数あるため、先に整理してください。",
  "イベントスタッフには X ID が必要です。",
  "このイベントには同じ X ID のスタッフが既に登録されています。",
  "イベント代表者には、承認済みX IDとowner roleのaccount linkが必要です。",
  "権限が不足しています (event.members)",
  "代表権限を付与できるのはイベント代表者または管理者だけです。",
  "自分の権限を変更する理由を入力してください。",
  "代表権限の移譲理由を入力してください。",
  "移譲元は現在の代表者である必要があります。",
  "移譲先は同じイベントに登録済みのスタッフを選択してください。",
  "移譲元と移譲先に同じスタッフは指定できません。",
  "一括スタッフ更新に対象行がありません。",
  "一括スタッフ更新に重複した行があります。",
  "更新対象のスタッフが見つからないため、一括更新を中止しました。",
  "新規スタッフ ID が既存行と衝突しています。",
  "代表者の追加・変更は一括更新では行えません。専用の代表者移譲操作を使用してください。",
  "同じイベントに同一 X ID のスタッフを重複登録できません。",
  "同一イベントに同一 X ID のスタッフを重複登録できません。",
  "自分自身のスタッフ権限は一括更新できません。個別の確認付き操作を使用してください。",
  "スタッフ一括置換には理由が必要です。",
  "一括スタッフ置換に重複または空のスタッフ ID があります。",
]);

function domainMessage(error: unknown, eventId: string): string | null {
  let message: unknown;
  try {
    if (!(error instanceof Error)) return null;
    message = error.message;
  } catch {
    // A getter or Proxy can throw during error classification itself.
    return null;
  }
  if (typeof message !== "string" || message.length > 240) return null;
  if (STAFF_SAFE_DOMAIN_MESSAGES.has(message)) return message;
  // Only reflect complete prompts for the validated route event, not
  // arbitrary text following a known prefix or another event's identifier.
  if (VALID_EVENT_ID.test(eventId)) {
    for (const action of ["SELF CHANGE", "REMOVE SELF", "TRANSFER"]) {
      if (message === `確認のため「${action} ${eventId}」と入力してください。`) return message;
    }
  }
  return null;
}

function staffDiagnostic(message: string): void {
  try {
    console.error(message);
  } catch {
    // Diagnostics must not replace a fixed error or a committed success.
  }
}

// CURRENT separates direct preparation-read failures from domain mutation
// failures. Discard the provider exception even if its text is identical
// to an allowlisted domain error or a confirmation prompt.
async function staffPreparationRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error("staff preparation read failed");
  }
}

async function queueProjection(c: import("hono").Context<AppEnv>, ctx: StaffContext, reason: string, includeUsers: boolean) {
  // CURRENT performs post-commit best-effort projection. Hono has no Queue binding
  // here: persist the same D1 intent; polling recovers the wake (D-15-6).
  try {
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
  } catch {
    // The staff/ownership write has already committed with strict audit.
    // Projection is post-commit best-effort: never turn a committed write into
    // an HTTP failure that invites clients to replay the mutation.
    staffDiagnostic("[MIG-0654] post-commit staff projection enqueue failed");
  }
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
  // CURRENT validates the supplied key list for every preset, including
  // non-custom presets whose valid keys will subsequently be ignored.
  const permissionInput = parseStaffPermissionInput(parsed.data.permission_keys);
  if (!permissionInput.ok) return deny(c, permissionInput.message, 400);
  try {
    const isAdmin = access.user.role === "admin";
    const a = assignment(parsed.data, permissionInput.keys, isAdmin);
    // Authorization is done before any private staff/X-user record is read.
    // Bounded legacy scan prevents two differently formatted rows from creating
    // duplicate canonical X identities. Fail closed when coverage is incomplete.
    const { results } = await staffPreparationRead(() => c.env.DB.prepare(
      "SELECT * FROM event_staff WHERE event_id = ? LIMIT 101",
    ).bind(access.eventId).all<EventStaffRow>());
    if (results.length > 100) return deny(c, GENERIC_FAILURE, 503);
    const matches = results.filter((r) => parseCanonicalXId(r.x_user_id) === xId);
    if (matches.length > 1) return deny(c, "同じX IDを指す既存スタッフ行が複数あります。", 409);
    const existing = targetId
      ? results.find((r) => r.id === targetId)
      : matches[0];
    if (targetId && !existing) return deny(c, "スタッフが見つかりません。", 404);
    // PUT must never adopt another staff row's canonical X identity.
    // Otherwise changing an existing row to an already-managed X may create
    // duplicate staff grants and ambiguity for owner/self-protection checks.
    if (targetId && matches.some((row) => row.id !== targetId)) {
      return deny(c, "同じX IDを指す既存スタッフが存在します。", 409);
    }
    if (existing && !VALID_STAFF_ID.test(existing.id)) return deny(c, GENERIC_FAILURE, 503);
    if (a.permission_preset === "owner" && existing?.permission_preset !== "owner") {
      await assertActorMayAssignOwner({ db: c.get("db"), eventId: access.eventId,
        actorUserId: access.user.id, isSiteAdmin: isAdmin });
    }
    const userExists = await staffPreparationRead(() => c.env.DB.prepare(
      "SELECT id FROM x_users WHERE id = ? LIMIT 1",
    ).bind(xId).first<{ id: string }>());
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
    const message = domainMessage(error, access.eventId);
    if (message) return deny(c, message, 409);
    staffDiagnostic("[MIG-0654] staff upsert unavailable");
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
  // SA-034 owner transfer: core performs input, self-confirm, operable-owner,
  // CAS, and strict-audit invariants in the same D1 mutation batch.
  const transferPath = "/events/:id/owner-transfer";
  app.use(transferPath, onlyMutating(costGuardMiddleware("manage_event_staff")));
  app.post(transferPath, async (c) => {
    c.header("Cache-Control", NO_STORE);
    const request = await readAdminJsonBody(c.req.raw);
    if (request.kind === "too_large") return deny(c, BODY_TOO_LARGE_MESSAGE, 413);
    if (request.kind !== "ok") return deny(c, "入力エラー", 400);
    const parsed = EventOwnerTransferBodySchema.safeParse(request.value);
    if (!parsed.success) return deny(c, parsed.error.issues[0]?.message ?? "入力エラー", 400);
    if (!VALID_STAFF_ID.test(parsed.data.from_staff_id) ||
        !VALID_STAFF_ID.test(parsed.data.to_staff_id) ||
        parsed.data.from_staff_id === parsed.data.to_staff_id) {
      return deny(c, "移譲元または移譲先のスタッフIDが不正です。", 400);
    }
    const access = await permitted(c);
    if (access instanceof Response) return access;
    try {
      await assertActorMayAssignOwner({
        db: c.get("db"), eventId: access.eventId,
        actorUserId: access.user.id, isSiteAdmin: access.user.role === "admin",
      });
      await transferEventOwnership({
        db: c.get("db"), eventId: access.eventId,
        fromStaffId: parsed.data.from_staff_id, toStaffId: parsed.data.to_staff_id,
        actorUserId: access.user.id, reason: parsed.data.reason,
        confirmText: parsed.data.confirm_text,
        selfConfirmText: parsed.data.self_confirm_text,
      });
      await queueProjection(c, access, parsed.data.reason, false);
      return c.json({ ok: true, pendingPublicReflection: true }, 200);
    } catch (error) {
      const message = domainMessage(error, access.eventId);
      if (message) return deny(c, message, 409);
      staffDiagnostic("[MIG-0654] owner transfer unavailable");
      return deny(c, GENERIC_FAILURE, 503);
    }
  });
  // SA-032 bulk import. The parent /:staffId write guard also matches /csv;
  // do not register a second parallel Origin/session/writeGuard stack.
  app.post(`${base}/csv`, async (c) => {
    c.header("Cache-Control", NO_STORE);
    const request = await readAdminJsonBody(c.req.raw);
    if (request.kind === "too_large") return deny(c, BODY_TOO_LARGE_MESSAGE, 413);
    if (request.kind !== "ok") return deny(c, "入力エラー", 400);
    const parsed = EventStaffCsvBodySchema.safeParse(request.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path ?? [];
      // CURRENT identifies the CSV line for an invalid X ID even when the
      // wire schema rejects it before canonical X-ID normalization.
      if (path[0] === "rows" && typeof path[1] === "number" && path[2] === "x_user_id") {
        const rows = request.value.rows;
        const rawRow = Array.isArray(rows) ? rows[path[1]] : null;
        const lineNumber = rawRow && typeof rawRow === "object" && typeof rawRow.lineNumber === "number"
          ? rawRow.lineNumber : path[1] + 1;
        return deny(c, `${lineNumber}行目: X IDが不正です`, 400);
      }
      return deny(c, issue?.message ?? "CSV入力エラー", 400);
    }
    const access = await permitted(c);
    if (access instanceof Response) return access;
    const isAdmin = access.user.role === "admin";
    type CsvNormalized = {
      line: number;
      xId: string;
      displayName: string;
      values: {
        x_user_id: string;
        display_name: string;
        permission_preset: UpsertBody["permission_preset"];
        custom_permission_keys_json: string | null;
        is_public: number;
        public_role_label: string | null;
      };
    };
    const normalized: CsvNormalized[] = [];
    try {
      for (const row of parsed.data.rows) {
        // CURRENT resolves preset/admin-only/owner policy before canonical X parsing.
        const a = assignmentFromCsv(row.permission_preset, row.permission_keys, isAdmin);
        if (a.permission_preset === "owner") {
          return deny(c, `${row.lineNumber}行目: 代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。`, 409);
        }
        const xId = parseCanonicalXId(row.x_user_id);
        if (!xId) return deny(c, `${row.lineNumber}行目: X IDが不正です`, 400);
        normalized.push({
          line: row.lineNumber, xId, displayName: row.display_name,
          values: {
            x_user_id: xId, display_name: row.display_name,
            permission_preset: a.permission_preset,
            custom_permission_keys_json: a.custom_permission_keys_json,
            is_public: Number(row.is_public_staff),
            public_role_label: row.public_role_label || null,
          },
        });
      }
    } catch (error) {
      const message = domainMessage(error, access.eventId);
      return deny(c, message ?? "CSV入力エラー", 400);
    }

    try {
      // Bound the legacy-canonical scan; never create duplicate staff grants
      // if the event has more rows than we can reliably examine.
      const staff = await staffPreparationRead(() => c.env.DB.prepare(
        "SELECT * FROM event_staff WHERE event_id = ? LIMIT 101",
      ).bind(access.eventId).all<EventStaffRow>());
      if (staff.results.length > 100) return deny(c, GENERIC_FAILURE, 503);
      const byX = new Map<string, EventStaffRow>();
      const requestedX = new Set(normalized.map((row) => row.xId));
      for (const row of staff.results) {
        const canonical = parseCanonicalXId(row.x_user_id);
        if (!canonical || !requestedX.has(canonical)) continue;
        if (byX.has(canonical)) {
          return deny(c, "同じX IDを指す既存スタッフ行が複数あるため、先に整理してください。", 409);
        }
        byX.set(canonical, row);
      }
      const known = await staffPreparationRead(() => c.env.DB.prepare(
        `SELECT id FROM x_users WHERE id IN (${normalized.map(() => "?").join(",")})`,
      ).bind(...normalized.map((row) => row.xId)).all<{ id: string }>());
      const knownIds = new Set(known.results.map((row) => row.id));
      const context = `event-staff-csv:${generateId("batch")}`;
      const newX = normalized.filter((row) => !knownIds.has(row.xId));
      const upserts = [];
      // CURRENT checks duplicate CSV X IDs only after every row has passed
      // assignment/X validation and after the existing-row scan.
      const seen = new Map<string, number>();
      for (const row of normalized) {
        const previous = seen.get(row.xId);
        if (previous !== undefined) {
          return deny(c, `${row.line}行目: X IDは${previous}行目と重複しています`, 409);
        }
        seen.set(row.xId, row.line);
        const existing = byX.get(row.xId) ?? null;
        if (existing?.permission_preset === "owner") {
          // This is a trusted local validation outcome, not a provider error.
          // Preserve CURRENT's row-specific message without widening domainMessage.
          return deny(c, `${row.line}行目: 代表者はCSVで変更できません。専用の代表者移譲操作を使用してください。`, 409);
        }
        if (existing && !VALID_STAFF_ID.test(existing.id)) {
          throw new Error("既存スタッフIDが不正です。");
        }
        upserts.push({
          id: existing?.id ?? generateId("es"),
          existingId: existing?.id ?? null,
          values: row.values,
        });
      }
      const mutations = upserts.length + newX.length;
      const budget = planD1AuditMutationBudget({
        mutationStatementCount: mutations, mutationAssertionCount: mutations,
        auditEntryCount: mutations, distinctActorCount: 1,
      });
      if (!budget.withinLimit) {
        return deny(c, `このCSVは1回の原子更新上限を超えています（${budget.totalQueryCount}/${budget.limit} query）。件数を分けて登録してください`, 400);
      }
      const extras: EventStaffBulkAtomicExtras = {
        mutationStatements: newX.map((row) => c.get("db").run(sql`
          INSERT INTO x_users (id, x_name, approval_status)
          VALUES (${row.xId}, ${row.displayName}, 'pending')
        `)),
        expectedMutationChanges: newX.map(() => 1),
        audits: newX.map((row) => ({
          table_name: "x_users", target_id: row.xId, operation: "CREATE",
          before: null,
          after: { id: row.xId, x_name: row.displayName, approval_status: "pending" },
          actor_user_id: access.user.id, reason: parsed.data.reason,
          context, retention_class: "long_audit", restore_strategy: "delete_created",
          strict: true,
        })),
      };
      await bulkUpsertEventStaffWithProtection({
        db: c.get("db"), eventId: access.eventId, actorUserId: access.user.id,
        reason: parsed.data.reason, context, now: Math.floor(Date.now() / 1000),
        upserts, atomicExtras: extras,
      });
      await queueProjection(c, access, parsed.data.reason, newX.length > 0);
      return c.json({ ok: true, pendingPublicReflection: true }, 200);
    } catch (error) {
      const message = domainMessage(error, access.eventId);
      if (message) return deny(c, message, 409);
      staffDiagnostic("[MIG-0654] CSV staff mutation unavailable");
      return deny(c, GENERIC_FAILURE, 503);
    }
  });
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
    const existing = await staffPreparationRead(() => c.env.DB.prepare(
      "SELECT * FROM event_staff WHERE event_id = ? AND id = ? LIMIT 1",
    ).bind(access.eventId, staffId).first<EventStaffRow>());
    if (!existing) return c.json({ ok: true }, 200);
    await deleteEventStaffWithProtection({
      db: c.get("db"), existing, actorUserId: access.user.id,
      reason: parsed.data.reason, confirmText: parsed.data.confirm_text,
      context: "event-staff-admin",
    });
    await queueProjection(c, access, parsed.data.reason, false);
    return c.json({ ok: true, pendingPublicReflection: true }, 200);
  } catch (error) {
    const message = domainMessage(error, access.eventId);
    if (message) return deny(c, message, 409);
    staffDiagnostic("[MIG-0654] staff delete unavailable");
    return deny(c, GENERIC_FAILURE, 503);
  }
});
}
