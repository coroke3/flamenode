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
} from "@flamenode/domain/eventTemplates";
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { mutateWithAudit } from "../../audit/mutateWithAudit.ts";
import { auditPreloaded } from "../admin/body.ts";
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

/** CURRENT src/lib/audit/expectedRowCondition.ts for a plain scalar row. */
export function expectedRowCondition(row: Record<string, unknown>): {
  sql: string;
  params: unknown[];
} {
  const predicates: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(row)) {
    const column = `"${key.replaceAll('"', '""')}"`;
    if (value === null) {
      predicates.push(`${column} IS NULL`);
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean"
    ) {
      predicates.push(`${column} = ?`);
      params.push(value);
    } else {
      return { sql: "0 = 1", params: [] };
    }
  }
  return predicates.length > 0
    ? { sql: predicates.join(" AND "), params }
    : { sql: "0 = 1", params: [] };
}

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

// SA-036 deleteEventTemplate
eventTemplateRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user")!.id;
  c.header("Cache-Control", "private, no-store");
  const validated = validateDeleteEventTemplateId(c.req.param("id"));
  if (!validated.ok) return result(c, 400, { ok: false, message: validated.message });
  const templateId = validated.templateId;

  try {
    const row = await db
      .prepare(
        `SELECT ${EVENT_TEMPLATE_COLUMNS.map((k) => `"${k}"`).join(", ")}
         FROM event_templates WHERE id = ? LIMIT 1`,
      )
      .bind(templateId)
      .first<TemplateRow>();
    if (!row) return result(c, 404, { ok: false, message: "テンプレートが見つかりません。" });

    const cas = expectedRowCondition({ ...row });
    await mutateWithAudit(db, {
      mutationStatements: [
        {
          sql: `DELETE FROM event_templates WHERE id = ? AND (${cas.sql})`,
          params: [templateId, ...cas.params],
        },
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
