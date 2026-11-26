// MIG-0734 U03: request bodies are built through the shared @flamenode/contracts body schemas (SA-016..020).
// Reads go through D-17-2 getJson (401 -> anonymous, 403 -> forbidden + allow-listed redirect, 404/501 mapped);
// writes go through D-17-3 send: HTTP 401 always maps to anonymous before parsing JSON;
// other valid {ok:boolean} response bodies preserve CURRENT write-guard messages such as
// cost_guard_blocked / maintenance_mode / banned / invalid_origin.
import {
  AdminCostGuardResponseSchema, CostGuardClearBodySchema, CostGuardDisabledBodySchema,
  CostGuardMaintenanceBodySchema, CostGuardModeBodySchema, CostGuardOverrideBodySchema,
  type AdminCostGuardResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

export type AdminWriteResult = { ok: boolean; message?: string; anonymous?: boolean; forbidden?: boolean; accessUnknown?: boolean };
export type AdminOpsBody = { ok: boolean; message?: string; reason?: string };
type BodySchema = { safeParse: (value: unknown) => { success: boolean; data?: unknown } };

/** Maps a D-17-3 send() result to the `{ok, message}` shape CURRENT's server actions returned. */
export function toWriteResult(result: OpsWriteResult<AdminOpsBody>, detectRevocation = false): AdminWriteResult {
  if (result.status === "ok") {
    const { ok, message, reason } = result.data;
    // D-17-3 send() handles HTTP 401 before JSON parsing. For non-401
    // well-formed error bodies, retain the reason-based anonymous fallback
    // for API compatibility without exposing private mutation controls.
    if (!ok && reason === "unauthenticated") {
      return { ok: false, message: typeof message === "string" ? message : "ログインしてください。", anonymous: true };
    }
    // These fixed Hono identity denials revoke admin access. Other HTTP 403
    // reasons (maintenance_mode, cost_guard_blocked, invalid_origin, etc.)
    // must retain their CURRENT in-form error behavior.
    if (detectRevocation && !ok && (reason === "forbidden" || reason === "banned")) {
      return { ok: false, message: typeof message === "string" ? message : "この操作を実行する権限がありません。", forbidden: true };
    }
    return { ok, ...(typeof message === "string" ? { message } : {}) };
  }
  if (result.status === "anonymous") return { ok: false, message: "ログインしてください。", anonymous: true };
  return { ok: false, message: "通信エラーが発生しました。" };
}

// A 403 may be an ordinary Cost Guard denial, so the status alone does not
// authorize redirecting to /dashboard. However an unreadable/stalled 403 body
// cannot leave privileged settings visible indefinitely.
export const COST_GUARD_403_BODY_DEADLINE_MS = 250;
async function bounded403Body(response: Response): Promise<{ reply: Response; accessUnknown: boolean }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
    timeout = setTimeout(() => resolve({ kind: "timeout" }), COST_GUARD_403_BODY_DEADLINE_MS);
  });
  const parsing: Promise<{ kind: "json"; value: unknown } | { kind: "invalid" }> =
    Promise.resolve().then(() => response.json()).then(
      (value: unknown) => ({ kind: "json" as const, value }),
      () => ({ kind: "invalid" as const }),
    );
  const parsed = await Promise.race([parsing, deadline]);
  if (timeout !== undefined) clearTimeout(timeout);
  const value = parsed.kind === "json" ? parsed.value : null;
  const known403Reasons = new Set([
    "forbidden", "banned", "unauthenticated",
    "maintenance_mode", "cost_guard_blocked", "invalid_origin",
    "tos_required", "tos_reaccept_required",
    "active_x_required", "active_x_rejected", "active_x_not_approved",
  ]);
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  // Only a recognized, negative write-guard result may preserve CURRENT's
  // inline 403 message or take an explicit auth redirect.
  if (!body || body.ok !== false || typeof body.reason !== "string" ||
      !known403Reasons.has(body.reason)) {
    return {
      reply: new Response('{"ok":false}', { status: 403, headers: { "content-type": "application/json" } }),
      accessUnknown: true,
    };
  }
  return {
    reply: new Response(JSON.stringify(value), { status: 403, headers: { "content-type": "application/json" } }),
    accessUnknown: false,
  };
}

export async function postAdminBody(
  fetchFn: OpsFetch, path: string, schema: BodySchema | null, raw?: object,
  options: { detectRevocation?: boolean } = {},
): Promise<AdminWriteResult> {
  let body: object | undefined;
  if (schema) {
    const checked = schema.safeParse(raw);
    if (!checked.success) return { ok: false, message: "入力内容が不正です。" };
    body = checked.data as object;
  }
  // Notification management also uses this transport. Preserve its existing
  // D-17-3 result semantics; only Cost Guard opts into the new auth latch.
  if (!options.detectRevocation) {
    return toWriteResult(await send<AdminOpsBody>(fetchFn, "POST", path, body));
  }
  let accessUnknown = false;
  let authoritativeHttpStatus: number | null = null;
  const boundedFetch: OpsFetch = async (url, init) => {
    const response = await fetchFn(url, init);
    authoritativeHttpStatus = response.status;
    if (response.status !== 403) return response;
    const bounded = await bounded403Body(response);
    accessUnknown = bounded.accessUnknown;
    return bounded.reply;
  };
  // D-17-3 send() deliberately hides HTTP status. Capture the *actual* status
  // before optional 403 JSON parsing: a 503 with a misleading forbidden reason
  // is not an authorization revocation and must not navigate away.
  const outcome = toWriteResult(await send<AdminOpsBody>(boundedFetch, "POST", path, body),
    authoritativeHttpStatus === 403);
  // The fixed-page retry checks the authoritative admin read before restoring
  // any private DTO. Do not classify an unparseable 403 as "forbidden".
  return accessUnknown
    ? { ok: false, accessUnknown: true, message: "管理権限を確認できません。再読み込みしてください。" }
    : outcome;
}

export async function fetchAdminCostGuard(
  fetchFn: OpsFetch, signal?: AbortSignal,
): Promise<OpsResult<AdminCostGuardResponse>> {
  const result = await getJson<unknown>(fetchFn, "/api/admin-read/ops/cost-guard", signal);
  if (result.status !== "ok") return result;
  const parsed = AdminCostGuardResponseSchema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

export function createAdminCostGuardApi(fetchFn: OpsFetch = (url, init) => fetch(url, init)) {
  const post = (path: string, schema: BodySchema, raw: object) =>
    postAdminBody(fetchFn, path, schema, raw, { detectRevocation: true });
  return {
    read: (signal?: AbortSignal) => fetchAdminCostGuard(fetchFn, signal),
    setMode: (mode: string, reason: string) =>
      post("/api/admin/cost-guard/mode", CostGuardModeBodySchema, { mode, reason }),
    setMaintenance: (enabled: boolean, reason: string) =>
      post("/api/admin/cost-guard/maintenance", CostGuardMaintenanceBodySchema, { is_maintenance_mode: String(enabled ? 1 : 0), reason }),
    setOverride: (reason: string, confirm: string, features: readonly string[]) =>
      post("/api/admin/cost-guard/override", CostGuardOverrideBodySchema, { reason, confirm, features: [...features] }),
    clearOverride: (reason: string, confirm: string) =>
      post("/api/admin/cost-guard/override/clear", CostGuardClearBodySchema, { reason, confirm }),
    setDisabled: (reason: string, confirm: string, features: readonly string[], expected: string | null) =>
      post("/api/admin/cost-guard/disabled-features", CostGuardDisabledBodySchema, {
        reason, confirm, features: [...features], expected_disabled_features_json: JSON.stringify(expected),
      }),
  };
}
export type AdminCostGuardApi = ReturnType<typeof createAdminCostGuardApi>;
