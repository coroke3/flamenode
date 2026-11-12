/** MIG-0731 U03a: Admin moderation list candidate; no unsafe write transport. */
import {
  AdminModerationResponseSchema, type AdminModerationResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type ModerationFilters = { type: string; status: string; overdue: boolean };
const types = new Set(["x_reapply", "void", "duplicate", "rights", "operator"]);
const statuses = new Set(["open", "resolved", "rejected", "expired", "cancelled"]);
/** Match CURRENT fallback on absent/unsupported params. */
export function moderationFilters(params: URLSearchParams): ModerationFilters {
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  return {
    type: types.has(type) ? type : "all",
    status: statuses.has(status) ? status : "open",
    overdue: params.get("overdue") === "1",
  };
}
export function moderationReadPath(filters: ModerationFilters): string {
  const params = new URLSearchParams({ type: filters.type, status: filters.status });
  if (filters.overdue) params.set("overdue", "1");
  return "/api/admin-read/moderation?" + params.toString();
}
export function createAdminModerationApi(fetchFn: OpsFetch = (path, init) => fetch(path, init)) {
  return {
    async list(filters: ModerationFilters, signal?: AbortSignal): Promise<OpsResult<AdminModerationResponse>> {
      const result = await getJson<unknown>(fetchFn, moderationReadPath(filters), signal);
      if (result.status !== "ok") return result;
      const parsed = AdminModerationResponseSchema.safeParse(result.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
  };
}
