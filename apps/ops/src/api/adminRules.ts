/** MIG-0727 U03a: CURRENT admin rules bounded read adapter; writes stay unmounted. */
import {
  AdminRuleDetailResponseSchema, AdminRulesResponseSchema,
  type AdminRuleDetailResponse, type AdminRulesResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
export type RuleStatus = "any" | "published" | "draft" | "archived";

export function ruleStatusQuery(values: URLSearchParams): RuleStatus {
  const status = values.get("status");
  return status === "published" || status === "draft" || status === "archived" ? status : "any";
}

export async function readAdminRules(
  values: URLSearchParams,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminRulesResponse>> {
  const status = ruleStatusQuery(values);
  const result = await getJson<unknown>(fetchFn, "/api/admin-read/rules?status=" + status, signal);
  if (result.status !== "ok") return result;
  const parsed = AdminRulesResponseSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.status !== status || parsed.data.items.length > 20 ||
      !Number.isInteger(parsed.data.reacceptRequiredCount) ||
      parsed.data.reacceptRequiredCount < 0 || parsed.data.reacceptRequiredCount > 30) {
    return { status: "unavailable" };
  }
  return { status: "ok", data: parsed.data };
}

export async function readAdminRuleDetail(
  id: string, fetchFn: OpsFetch = defaultFetch, signal?: AbortSignal,
): Promise<OpsResult<AdminRuleDetailResponse>> {
  if (!id) return { status: "notFound" };
  const result = await getJson<unknown>(fetchFn, "/api/admin-read/rules/" + encodeURIComponent(id), signal);
  if (result.status !== "ok") return result;
  const parsed = AdminRuleDetailResponseSchema.safeParse(result.data);
  return parsed.success && parsed.data.item.id === id
    ? { status: "ok", data: parsed.data }
    : { status: "unavailable" };
}
