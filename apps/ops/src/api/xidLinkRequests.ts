// MIG-0732 U01 provisional SA-090/091 client. Replace response typing with MIG-0605 contracts before merge.
import { AdminXLinkRequestsResponseSchema, type AdminXLinkRequestsResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

export interface LinkRequestMutationResult { ok: boolean; message?: string }

/** Mutations remain disabled until MIG-0605 backend parity and independent review are accepted. */
export function createXidLinkRequestsApi(fetchFn: OpsFetch, enableMutations = false) {
  return {
    async get(signal?: AbortSignal): Promise<OpsResult<AdminXLinkRequestsResponse>> {
      const response = await getJson<unknown>(fetchFn, "/api/admin-read/x-link-requests", signal);
      if (response.status !== "ok") return response;
      const parsed = AdminXLinkRequestsResponseSchema.safeParse(response.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
    approve(id: string): Promise<OpsWriteResult<LinkRequestMutationResult>> {
      if (!enableMutations) return Promise.resolve({ status: "unavailable" });
      return send(fetchFn, "POST", "/api/xid/link-requests/" + encodeURIComponent(id) + "/approve");
    },
    reject(id: string, reason: string): Promise<OpsWriteResult<LinkRequestMutationResult>> {
      if (!enableMutations) return Promise.resolve({ status: "unavailable" });
      return send(fetchFn, "POST", "/api/xid/link-requests/" + encodeURIComponent(id) + "/reject", { reason: reason.trim() });
    },
  };
}
export type XidLinkRequestsApi = ReturnType<typeof createXidLinkRequestsApi>;
