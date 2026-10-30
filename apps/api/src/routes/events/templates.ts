/**
 * MIG-0604 U04 (partial): SA-036 deleteEventTemplate on Hono.
 * CURRENT: src/lib/actions/event-template-admin.ts deleteEventTemplate.
 * Order: session -> writeGuard (admin) -> CostGuard("admin_event_templates")
 * -> validateDeleteEventTemplateId (@flamenode/domain/eventTemplates)
 * -> row read -> single D1 batch (CAS DELETE on every scalar column read in
 * preflight, expected 1 change) + strict audit (context/reason as CURRENT).
 * Result body keeps EventTemplateActionResult; HTTP status: validation 400 /
 * not found 404 / CAS conflict 409 / other 500. revalidatePath is Next-only.
 */
import {
  type EventTemplateActionResult,
  validateDeleteEventTemplateId,
  validateSaveEventTemplateInput,
  snapshotFromEvent,
  type EventRow,
  type EventTemplateQuestionRow,
} from "@flamenode/domain/eventTemplates";
import { generateId } from "@flamenode/server-core/id";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { sql } from "@flamenode/server-core/sql";
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";

export const EVENT_TEMPLATE_FAILURE_MESSAGE =
  "処理に失敗しました。再読み込みして、もう一度お試しください。";

// Drizzle select() column order of packages/db schema `event_templates`.
export const EVENT_TEMPLATE_COLUMNS = [
  "id",
  "name",
  "description",
  "source_event_id",
  "settings_json",
  "created_by_user_id",
  "created_at",
  "updated_at",
] as const;

type TemplateRow = Record<(typeof EVENT_TEMPLATE_COLUMNS)[number], unknown>;

function result(
  c: { json: (b: unknown, s: 200 | 400 | 404 | 409 | 500) => Response },
  status: 200 | 400 | 404 | 409 | 500,
  body: EventTemplateActionResult,
): Response {
  return c.json(body, status);
}

/** D1 surfaces the changes() assertion (json_extract on invalid JSON) as malformed JSON. */
function isAssertionConflict(error: unknown): boolean {
  return error instanceof Error && /malformed JSON/i.test(error.message);
}

export const eventTemplateRoutes = new Hono<AppEnv>();
eventTemplateRoutes.use("*", costGuardMiddleware("admin_event_templates"));


/**
 * MIG-0655 U02 / SA-035: preserve the CURRENT snapshot shape and strict
 * audit/INSERT atomicity. The new API does not call Next revalidatePath.
 * Stage permission questions are reused from the same ordered question read,
 * avoiding an additional D1 request or a second source of truth.
 */
eventTemplateRoutes.post("/", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const validated = validateSaveEventTemplateInput(body.value);
  if (!validated.ok) return c.json({ ok: false, message: validated.message }, 400);
  const input = validated.data;
  const db = c.get("db");
  const userId = c.get("user")!.id;
  try {
    // S3: user/terms + CostGuard + this one SELECT (questions as correlated JSON).
    // A separate question read would exceed the three-read D1 budget.
    const event = await c.env.DB.prepare(`
      SELECT e.*,
        (SELECT json_group_array(json_object(
          'question_key', q.question_key, 'label', q.label,
          'description', q.description, 'type', q.type, 'required', q.required,
          'options_json', q.options_json, 'placeholder', q.placeholder,
          'max_length', q.max_length, 'sort_order', q.sort_order,
          'is_active', q.is_active, 'visibility', q.visibility
        )) FROM (
          SELECT question_key, label, description, type, required, options_json,
                 placeholder, max_length, sort_order, is_active, visibility
          FROM event_custom_questions WHERE event_id = e.id
          ORDER BY sort_order ASC, question_key ASC
          LIMIT 101
        ) q) AS questions_json
      FROM events e WHERE e.id = ? LIMIT 1
    `).bind(input.event_id).first<EventRow & { id: string; questions_json: string | null }>();
    if (!event) {
      return c.json({ ok: false, message: "イベントが見つかりません。" }, 404);
    }
    const questionData: unknown = JSON.parse(event.questions_json ?? "[]");
    if (!Array.isArray(questionData) || questionData.length > 100) {
      // Do not silently serialize an incomplete template.
      return c.json({ ok: false, message: EVENT_TEMPLATE_FAILURE_MESSAGE }, 409);
    }
    const questions = questionData as EventTemplateQuestionRow[];
    const stageQuestions = [...questions]
      .filter((q) => q.question_key === "stage_permission" || q.question_key.startsWith("stage_permission_"))
      .sort((a, b) => a.sort_order - b.sort_order);
    const formSettingsJson = stageQuestions.length === 0 ? null : JSON.stringify({
      stage_permissions: stageQuestions.map((q) => ({
        id: q.question_key,
        enabled: q.is_active === 1,
        required: q.required === 1,
        label: q.label,
        description: q.description ?? "",
        placeholder: q.placeholder ?? "",
      })),
    });
    const now = Math.floor(Date.now() / 1000);
    const after = {
      id: generateId("etmpl"),
      name: input.name,
      description: input.description ?? null,
      source_event_id: event.id,
      settings_json: JSON.stringify(snapshotFromEvent(event, questions, formSettingsJson)),
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
    };
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`INSERT INTO event_templates (
          id, name, description, source_event_id, settings_json,
          created_by_user_id, created_at, updated_at
        ) VALUES (
          ${after.id}, ${after.name}, ${after.description}, ${after.source_event_id},
          ${after.settings_json}, ${after.created_by_user_id}, ${after.created_at}, ${after.updated_at}
        )`),
      ],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "event_templates",
        target_id: after.id,
        operation: "CREATE",
        after: { ...after },
        actor_user_id: userId,
        context: "admin_event_templates",
        reason: "イベントテンプレートを保存",
        retention_class: "normal",
        strict: true,
      }],
    });
    return c.json({ ok: true, templateId: after.id, message: "テンプレートを保存しました。" }, 200);
  } catch {
    // Driver errors may embed SQL/credentials; return only a stable private message.
    console.error("[event-template-admin] CREATE_FAILED");
    return c.json({ ok: false, message: EVENT_TEMPLATE_FAILURE_MESSAGE }, 500);
  }
});

// SA-036 deleteEventTemplate
eventTemplateRoutes.delete("/:id", async (c) => {
  const db = c.get("db");
  const userId = c.get("user")!.id;
  c.header("Cache-Control", "private, no-store");
  const validated = validateDeleteEventTemplateId(c.req.param("id"));
  if (!validated.ok) return result(c, 400, { ok: false, message: validated.message });
  const templateId = validated.templateId;

  try {
    const row = await c.env.DB
      .prepare(
        `SELECT ${EVENT_TEMPLATE_COLUMNS.map((k) => `"${k}"`).join(", ")}
         FROM event_templates WHERE id = ? LIMIT 1`,
      )
      .bind(templateId)
      .first<TemplateRow>();
    if (!row) return result(c, 404, { ok: false, message: "テンプレートが見つかりません。" });

    const cas = expectedRowCondition({ expectedCurrent: { ...row } });
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`DELETE FROM event_templates WHERE id = ${templateId} AND (${cas})`),
      ],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "event_templates",
          target_id: templateId,
          operation: "DELETE",
          before: { ...row },
          actor_user_id: userId,
          context: "admin_event_templates",
          reason: "イベントテンプレートを削除",
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    console.error("[event-template-admin] operation failed", error);
    return result(c, isAssertionConflict(error) ? 409 : 500, {
      ok: false,
      message: EVENT_TEMPLATE_FAILURE_MESSAGE,
    });
  }
  return result(c, 200, { ok: true, message: "テンプレートを削除しました。" });
});
