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
         t.name AS tpl_name, CASE WHEN typeof(t.settings_json) = 'text' AND length(CAST(t.settings_json AS BLOB)) <= ? THEN t.settings_json END AS tpl_settings,
         length(CAST(t.settings_json AS BLOB)) AS tpl_size
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

// One stringify of a string slice costs at most 6 bytes per UTF-16 code unit
// (well-formed JSON escapes), plus two quotes. Never split a surrogate pair.
const TEMPLATE_JSON_STRING_SLICE = 8192;
const TEMPLATE_JSON_CHUNK_TARGET = 4096;

// The DTO consists of fixed records, a bounded row array and D1 scalar values.
// Count a conservative wire-byte upper bound without encoding large strings.
function fitsTemplateJsonBuffer(value: unknown): boolean {
  let remaining = MAX_JSON_COLUMN_BYTES;
  const spend = (bytes: number) => (remaining -= bytes) >= 0;
  const fits = (item: unknown): boolean => {
    if (typeof item === "string") return spend(2 + 6 * item.length);
    if (item === null || item === undefined) return spend(4);
    if (typeof item === "boolean") return spend(5);
    if (typeof item === "number") return spend(32);
    if (typeof item !== "object" || !spend(2)) return false;
    if (Array.isArray(item)) {
      for (const entry of item) if (!spend(1) || !fits(entry)) return false;
      return true;
    }
    for (const [key, entry] of Object.entries(item)) {
      if (!spend(2) || !fits(key) || !fits(entry)) return false;
    }
    return true;
  };
  return fits(value);
}

function* templateJsonFragments(value: unknown): Generator<string, void, unknown> {
  if (typeof value === "string") {
    if (value.length <= TEMPLATE_JSON_STRING_SLICE) {
      yield JSON.stringify(value);
      return;
    }
    yield '"';
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + TEMPLATE_JSON_STRING_SLICE, value.length);
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
          value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
      yield JSON.stringify(value.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '"';
    return;
  }
  if (value === null || typeof value !== "object") {
    yield JSON.stringify(value) ?? "null";
    return;
  }
  if (Array.isArray(value)) {
    yield "[";
    let first = true;
    for (const entry of value) {
      if (!first) yield ",";
      first = false;
      yield* templateJsonFragments(entry);
    }
    yield "]";
    return;
  }
  yield "{";
  let first = true;
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
    if (!first) yield ",";
    first = false;
    yield* templateJsonFragments(key);
    yield ":";
    yield* templateJsonFragments(entry);
  }
  yield "}";
}

// Preserve the exact JSON shape and small-response fast path. For a large
// DTO, the iterator owns only already-read data: no D1 work after headers.
// Each pull holds <4096 code units plus one <=49154-byte fragment, so even
// a maximally escaped string cannot create a >64 KiB encoded chunk.
function templateJsonBody(body: AdminEventTemplatesResponse | AdminEventNewResponse): string | ReadableStream<Uint8Array> {
  if (fitsTemplateJsonBuffer(body)) return JSON.stringify(body);
  const fragments = templateJsonFragments(body);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk = "";
      while (chunk.length < TEMPLATE_JSON_CHUNK_TARGET) {
        const next = fragments.next();
        if (next.done) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += next.value;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() { fragments.return(undefined); },
  });
}

export const adminEventTemplatesRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const guard = await loadGuard(c, "");
  const body: AdminEventTemplatesResponse = {
    guardOk: guard.ok,
    templates: guard.ok ? await listTemplates(c.env.DB) : [],
  };
  return c.body(templateJsonBody(body), 200, { "Content-Type": "application/json; charset=UTF-8" });
});

/** The SQL projection bounds stored TEXT bytes; a provider can expand malformed UTF-8 on decode.
 * Keep the same nullable raw-string contract without parsing or truncating the snapshot.
 */
function boundedTemplateSettings(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_JSON_COLUMN_BYTES) return null;
  if (value.length <= Math.floor(MAX_JSON_COLUMN_BYTES / 3)) return value;
  return new TextEncoder().encodeInto(value, new Uint8Array(MAX_JSON_COLUMN_BYTES)).read === value.length
    ? value : null;
}

export const adminEventNewRoutes = new Hono<AppEnv>().get("/", async (c) => {
  // CURRENT Next passes repeated search parameters as an array, not a string.
  // Match the Ops new-event reader: only a single template value selects a row.
  const raw = c.req.queries("template");
  const templateId = raw?.length === 1 ? raw[0]!.trim() : "";
  const guard = await loadGuard(c, templateId);
  const templates = guard.ok ? await listTemplates(c.env.DB) : [];
  const row = guard.row;
  const body: AdminEventNewResponse = {
    guardOk: guard.ok,
    templates,
    userId: c.get("user")?.id ?? "",
    templateId,
    templateName: templateId && row?.tpl_name != null ? row.tpl_name : null,
    templateSettingsJson: templateId && row ? boundedTemplateSettings(row.tpl_settings) : null,
    formInitial: "deferred",
  };
  return c.body(templateJsonBody(body), 200, { "Content-Type": "application/json; charset=UTF-8" });
});
