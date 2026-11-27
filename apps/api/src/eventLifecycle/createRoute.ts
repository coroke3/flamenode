/**
 * MIG-0652 U03 / SA-022: unmounted event-create candidate for new IDs.
 * CURRENT: src/lib/actions/event-admin.ts#createEvent.
 *
 * The existing admin parent must supply Origin -> session -> admin writeGuard
 * -> dbMiddleware exactly once. This router is exercised only in local tests;
 * it is not registered in app.ts or routes/events/index.ts. Rename-tombstone
 * reuse still needs its own R2 precommit/compensation path and fails closed.
 */
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { events, eventTemplates, publicVisibilityFences, users, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import {
  buildEventCreateFields, buildEventCreateOwnerStaffRow,
  buildEventCreateStageQuestionRows, buildEventCreateTemplateQuestionRows,
  generalCustomQuestionsPresentCore, readGeneralCustomQuestionsFromFormDataCore,
  parseGeneralQuestionType, normalizeGeneralQuestionOptions,
  plannedGeneralQuestionsFromDraftsCore, planEventCreateQuestionBatch,
} from "@flamenode/domain/event";
import { EVENT_ID_PATTERN, parseEventForm, resolveSubmittedEventVisibility, buildVideoFormSettingsJson } from "@flamenode/domain/event/form";
import { parseEventTemplateSnapshot, type EventTemplateSnapshot } from "@flamenode/domain/eventTemplates";
import { serializeRequiredVideoFieldsFromForm } from "@flamenode/domain/video";
import { isStagePermissionQuestionKey, resolveStagePermissionFieldsFromJson } from "@flamenode/domain/video/formSettings";
import { normalizeXId } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { generateId } from "@flamenode/server-core/id";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildEventChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../env.ts";
import { costGuardMiddleware } from "../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../routes/admin/body.ts";
import { planEventCreateAtomicWrite } from "./createMutationPlan.ts";

const CREATE_FAILURE = "イベント作成に失敗しました。状態を再取得してもう一度お試しください。";
const ACTIVE_X_REQUIRED = "イベント作成には承認済みの Active X ID が必要です。";
const LINKED_X_REQUIRED = "イベント作成には認証ユーザーへ紐付いた X 名義が必要です。";
const TOMBSTONE_UNAVAILABLE = "このイベントIDは旧URLの公開データ削除中です。削除完了後に再試行してください。";

/** JSON carries text FormData values; repeated controls use ordered arrays. */
function readCreateForm(body: Record<string, unknown>): FormData | null {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    const values = Array.isArray(value) ? value : [value];
    if (!values.every((item): item is string => typeof item === "string")) return null;
    for (const item of values) form.append(key, item);
  }
  return form;
}

/**
 * CURRENT getCurrentUser resolves normalized/sole-approved linked identities,
 * then createEvent trims that raw ID and performs an exact approved-link lookup.
 * Keep that order and first-row alias behavior. No new cap or SQL lower()/trim()
 * may replace CURRENT's JavaScript normalization. Keep the final SQL lookup:
 * driver-decoded legacy strings are not proof of exact stored-ID equality.
 */
async function loadCreateOwner(db: ServerCoreDb, actorUserId: string) {
  const rows = await db.select({
    persistedActiveXUserId: users.active_x_user_id,
    persistedActiveXType: sql<string>`typeof(${users.active_x_user_id})`,
    persistedActiveXHex: sql<string>`hex(CAST(${users.active_x_user_id} AS BLOB))`,
    xUserId: xUsers.id,
    approvalStatus: xUsers.approval_status,
  }).from(users)
    .leftJoin(xUserAccountLinks, eq(xUserAccountLinks.auth_user_id, users.id))
    .leftJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(eq(users.id, actorUserId));
  const persistedActiveXUserId = rows[0]?.persistedActiveXUserId ?? null;
  const linkedIds = new Map<string, string>();
  for (const row of rows) {
    if (row.approvalStatus !== "approved" || row.xUserId === null) continue;
    const normalized = normalizeXId(row.xUserId);
    if (normalized && !linkedIds.has(normalized)) linkedIds.set(normalized, row.xUserId);
  }
  const normalizedCurrent = normalizeXId(persistedActiveXUserId);
  const resolved = linkedIds.get(normalizedCurrent) ??
    (linkedIds.size === 1 ? linkedIds.values().next().value : null);
  const activeXUserId = resolved?.trim() || null;
  if (!activeXUserId) return { ok: false as const, message: ACTIVE_X_REQUIRED };
  const selected = (await db.select({
    x_user_id: xUserAccountLinks.x_user_id,
    display_name: xUsers.x_name,
    displayNameType: sql<string>`typeof(${xUsers.x_name})`,
    displayNameHex: sql<string>`hex(CAST(${xUsers.x_name} AS BLOB))`,
  }).from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(and(
      eq(xUserAccountLinks.auth_user_id, actorUserId),
      eq(xUserAccountLinks.x_user_id, activeXUserId),
      eq(xUsers.approval_status, "approved"),
    )).limit(1))[0];
  if (!selected) {
    return { ok: false as const, message: LINKED_X_REQUIRED };
  }
  return {
    ok: true as const,
    // Storage witnesses preserve NULL/type/bytes even if a driver decodes a
    // legacy NUL-containing value differently. Only decoded CURRENT fields
    // become the new owner row and audit payload.
    persistedActiveX: { type: rows[0]!.persistedActiveXType, hex: rows[0]!.persistedActiveXHex },
    displayName: { type: selected.displayNameType, hex: selected.displayNameHex },
    identity: { x_user_id: selected.x_user_id, display_name: selected.display_name },
  };
}

export const eventCreateRoutes = new Hono<AppEnv>();
eventCreateRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const user = c.get("user");
  if (!user || user.role !== "admin" || !c.get("db")) {
    return c.json({ ok: false, message: "操作する権限がありません。" }, 403);
  }
  await next();
});

// The longer handler intentionally follows CURRENT's validation/effect order;
// no generic CRUD dispatcher or independently committing mutation is involved.
eventCreateRoutes.post("/", costGuardMiddleware("admin_event_create"), async (c) => {
  const incoming = await readAdminJsonBody(c.req.raw);
  if (incoming.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (incoming.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const formData = readCreateForm(incoming.value);
  if (!formData) return c.json({ ok: false, message: "入力エラー" }, 400);
  const parsed = parseEventForm(formData);
  if (!parsed.ok) return c.json(parsed, 400);
  const data = parsed.data;
  const id = data.id?.trim() || generateId("ev");
  if (!EVENT_ID_PATTERN.test(id)) {
    return c.json({ ok: false, message: "イベントIDは64文字以内で、英数字・_・-のみ使用できます。" }, 400);
  }

  const db = c.get("db");
  const actorUserId = c.get("user")!.id;
  const now = Math.floor(Date.now() / 1000);
  try {
    let templateSnapshot: EventTemplateSnapshot | null = null;
    const templateId = data.template_id?.trim();
    if (templateId) {
      const template = (await db.select({ settings_json: eventTemplates.settings_json })
        .from(eventTemplates).where(eq(eventTemplates.id, templateId)).limit(1))[0];
      if (!template) return c.json({ ok: false, message: "指定したテンプレートが見つかりません。" }, 400);
      templateSnapshot = parseEventTemplateSnapshot(template.settings_json);
      if (!templateSnapshot) return c.json({ ok: false, message: "テンプレートの設定データが不正です。" }, 400);
    }
    const duplicate = (await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1))[0];
    if (duplicate) return c.json({ ok: false, message: `ID「${id}」は既に存在します。` }, 409);
    const renameTombstone = (await db.select({ token: publicVisibilityFences.fence_token })
      .from(publicVisibilityFences).where(and(
        eq(publicVisibilityFences.entity_type, "event"),
        eq(publicVisibilityFences.entity_id, id),
        eq(publicVisibilityFences.state, "blocked"),
        eq(publicVisibilityFences.reason, "event_id_rename_old_cleanup"),
      )).limit(1))[0];
    const owner = await loadCreateOwner(db, actorUserId);
    if (!owner.ok) return c.json({ ok: false, message: owner.message }, 400);

    const eventRow = buildEventCreateFields({
      id, data, now, templateSnapshot,
      visibilityStatus: resolveSubmittedEventVisibility(data),
      requiredVideoFieldsJson: serializeRequiredVideoFieldsFromForm(formData),
    });
    const ownerRow = buildEventCreateOwnerStaffRow({
      staffId: generateId("es"), eventId: id, actorUserId,
      verifiedOwnerIdentity: owner.identity, now,
    });
    const templateGeneralQuestions = buildEventCreateTemplateQuestionRows({
      eventId: id, templateSnapshot, now,
      createId: () => generateId("ecq"), isStagePermissionQuestionKey,
    });
    const questions = planEventCreateQuestionBatch({
      templateGeneralQuestions,
      submittedGeneral: generalCustomQuestionsPresentCore(formData)
        ? {
            present: true,
            planned: plannedGeneralQuestionsFromDraftsCore({
              eventId: id, now, createId: () => generateId("ecq"),
              drafts: readGeneralCustomQuestionsFromFormDataCore(formData, {
                parseQuestionType: parseGeneralQuestionType,
                normalizeOptionList: normalizeGeneralQuestionOptions,
                isStagePermissionQuestionKey,
              }),
            }),
          }
        : { present: false },
      stageQuestions: buildEventCreateStageQuestionRows({
        eventId: id, now, createId: () => generateId("ecq"),
        fields: resolveStagePermissionFieldsFromJson([buildVideoFormSettingsJson(formData)]),
      }),
    });
    if (!questions.ok) return c.json(questions, 400);
    // No R2 operation or tombstone deletion is legal in this bounded candidate.
    if (renameTombstone) return c.json({ ok: false, message: TOMBSTONE_UNAVAILABLE }, 503);

    const queue = await buildEventChangeQueueBatch(db, {
      eventId: id, reason: "event_create", requestedByUserId: actorUserId, priority: "high",
    });
    const plan = planEventCreateAtomicWrite({
      db, eventRow, ownerRow, questionRows: questions.questions, questionChunks: questions.chunks,
      queue, actorUserId, ownerSnapshot: owner,
      hasRenameTombstone: false, preloaded: auditPreloaded(c),
      // Successful parent stack: session + ToS + CostGuard; this handler:
      // duplicate + tombstone + linked-X resolution + exact owner lookup,
      // and optional template.
      // buildEventChangeQueueBatch plans SQL without executing a query.
      callerQueryCount: templateId ? 8 : 7,
    });
    if (!plan.ok) return c.json({ ok: false, message: plan.message }, 409);
    await mutateWithAudit(db, plan);
    // D-0603-1: retain the atomic Queue rows with zero Hono wake calls.
    // CURRENT CREATE's post-commit effects are Next-only path revalidation.
    return c.json({
      ok: true, eventId: id,
      ...(queue.statements.length > 0 ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch {
    console.error("[MIG-0652] EVENT_CREATE_FAILED");
    return c.json({ ok: false, message: CREATE_FAILURE }, 500);
  }
});
