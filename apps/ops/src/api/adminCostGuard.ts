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

export type AdminWriteResult = { ok: boolean; message?: string; anonymous?: boolean };
export type AdminOpsBody = { ok: boolean; message?: string; reason?: string };
type BodySchema = { safeParse: (value: unknown) => { success: boolean; data?: unknown } };

/** Maps a D-17-3 send() result to the `{ok, message}` shape CURRENT's server actions returned. */
export function toWriteResult(result: OpsWriteResult<AdminOpsBody>): AdminWriteResult {
  if (result.status === "ok") {
    const { ok, message, reason } = result.data;
    // D-17-3 send() handles HTTP 401 before JSON parsing. For non-401
    // well-formed error bodies, retain the reason-based anonymous fallback
    // for API compatibility without exposing private mutation controls.
    if (!ok && reason === "unauthenticated") {
      return { ok: false, message: typeof message === "string" ? message : "ログインしてください。", anonymous: true };
    }
    return { ok, ...(typeof message === "string" ? { message } : {}) };
  }
  if (result.status === "anonymous") return { ok: false, message: "ログインしてください。", anonymous: true };
  return { ok: false, message: "通信エラーが発生しました。" };
}

export async function postAdminBody(
  fetchFn: OpsFetch, path: string, schema: BodySchema | null, raw?: object,
): Promise<AdminWriteResult> {
  let body: object | undefined;
  if (schema) {
    const checked = schema.safeParse(raw);
    if (!checked.success) return { ok: false, message: "入力内容が不正です。" };
    body = checked.data as object;
  }
  return toWriteResult(await send<AdminOpsBody>(fetchFn, "POST", path, body));
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
  const post = (path: string, schema: BodySchema, raw: object) => postAdminBody(fetchFn, path, schema, raw);
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
