import { Hono } from "hono";
import type {
  AdminEventNewResponse,
  AdminEventTemplateRow,
  AdminEventTemplatesResponse,
} from "@flamenode/contracts";
import { evaluateCostGuardCore, evaluateWriteIdentity } from "@flamenode/domain/admin";
import type { AppEnv } from "../../env.ts";
import { TERMS_REACCEPT_REQUIRED_CASE_SQL, TERMS_REACCEPT_REQUIRED_CTE_SQL } from "../personal/context.ts";
import { MAX_JSON_COLUMN_BYTES } from "../personal/context.ts";

// CURRENT: app/(admin)/admin/events/templates/page.tsx and events/new/page.tsx, both via listEventTemplatesForAdmin()
// = requireAdminWrite("admin_event_templates") (banned / TOS / re-accept / admin role / CostGuard mode+feature, fail-closed)
// then a list. Guard denied -> EMPTY list, page still renders (guardOk:false). D1 (<= 3 incl. session): (1) guard inputs
// (+ the requested template row for /new), (2) the list. Guard-read failure -> denied (CURRENT's try/catch -> deny);
// list failure -> 503. DIVERGENCE: CURRENT's list is unbounded; capped at ADMIN_EVENT_TEMPLATES_LIMIT.
export const ADMIN_EVENT_TEMPLATES_LIMIT = 100;

interface GuardRow {
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
  has_settings: number;
  tpl_name: string | null;
  tpl_settings: string | null;
  tpl_size: number | null;
}

async function loadGuard(
  c: { env: AppEnv["Bindings"]; get(key: "user"): AppEnv["Variables"]["user"] },
  templateId: string,
): Promise<{ ok: boolean; row: GuardRow | null }> {
  const user = c.get("user");
  if (!user) return { ok: false, row: null };
  let row: GuardRow | null = null;
  try {
    row = await c.env.DB.prepare(
      `${TERMS_REACCEPT_REQUIRED_CTE_SQL}
       SELECT u.is_tos_accepted AS is_tos_accepted, ${TERMS_REACCEPT_REQUIRED_CASE_SQL} AS terms_reaccept_required,
         s.operation_mode AS operation_mode, s.disabled_features_json AS disabled_features_json,
         s.cost_guard_exception_until AS cost_guard_exception_until,
         s.cost_guard_exception_features_json AS cost_guard_exception_features_json,
         CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS has_settings,
         t.name AS tpl_name, CASE WHEN length(t.settings_json) <= ? THEN t.settings_json END AS tpl_settings,
         length(t.settings_json) AS tpl_size
       FROM "user" u
       LEFT JOIN system_settings s ON s.id = 'default'
       LEFT JOIN event_templates t ON t.id = ? AND ? <> ''
       WHERE u.id = ? LIMIT 1`,
    )
      .bind(MAX_JSON_COLUMN_BYTES, templateId, templateId, user.id)
      .first<GuardRow>();
  } catch {
    console.error("[adminRead:eventTemplates] GUARD_READ_FAILED");
    return { ok: false, row: null };
  }
  if (!row) return { ok: false, row: null };
  if (
    evaluateWriteIdentity(
      {
        role: user.role,
        is_banned: user.is_banned,
        is_tos_accepted: row.is_tos_accepted ?? 0,
        terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
      },
      "admin",
    )
  ) {
    return { ok: false, row };
  }
  if (!row.has_settings) return { ok: false, row };
  const decision = evaluateCostGuardCore({
    feature: "admin_event_templates",
    operationMode: row.operation_mode,
    disabledFeaturesJson: row.disabled_features_json,
    exceptionUntil: row.cost_guard_exception_until,
    exceptionFeaturesJson: row.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
  return { ok: !decision.blocked, row };
}

async function listTemplates(db: D1Database): Promise<AdminEventTemplateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, description, source_event_id, updated_at FROM event_templates ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(ADMIN_EVENT_TEMPLATES_LIMIT)
    .all<AdminEventTemplateRow>();
  return results;
}

export const adminEventTemplatesRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const guard = await loadGuard(c, "");
  const body: AdminEventTemplatesResponse = {
    guardOk: guard.ok,
    templates: guard.ok ? await listTemplates(c.env.DB) : [],
  };
  return c.json(body);
});

export const adminEventNewRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const raw = c.req.query("template");
  const templateId = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
  const guard = await loadGuard(c, templateId);
  const templates = guard.ok ? await listTemplates(c.env.DB) : [];
  const row = guard.row;
  const body: AdminEventNewResponse = {
    guardOk: guard.ok,
    templates,
    userId: c.get("user")?.id ?? "",
    templateId,
    templateName: templateId && row?.tpl_name != null ? row.tpl_name : null,
    templateSettingsJson: templateId && row ? row.tpl_settings : null,
    formInitial: "deferred",
  };
  return c.json(body);
});
