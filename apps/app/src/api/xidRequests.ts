/** MIG-0709: consume the merged MIG-0659 response contract; never infer success from HTTP 2xx alone. */
import { XIdRequestResultSchema, type XIdRequestResult } from "@flamenode/contracts";

export type XidRequestResult = XIdRequestResult;

export interface XidRequestsApi {
  requestLink(xId: string): Promise<XidRequestResult>;
  requestMerge(sourceXId: string, targetXUserId: string): Promise<XidRequestResult>;
  cancelRequest(requestId: string): Promise<XidRequestResult>;
  requestMergeRevert(parentRequestId: string): Promise<XidRequestResult>;
}

import { send, type FetchLike } from "./write.js";

async function write(
  fetchFn: FetchLike,
  path: string,
  payload?: Record<string, string>,
): Promise<XidRequestResult> {
  // D-16-2 shared write transport owns same-origin, no-store, JSON/no-body,
  // network failures and 401 precedence. Validate the MIG-0659 body separately.
  const response = await send<XidRequestResult>(fetchFn, "POST", path, payload);
  if (response.status === "anonymous") {
    return { ok: false, message: "ログイン状態を再確認してください。" };
  }
  if (response.status === "unavailable") {
    return { ok: false, message: "申請の保存に失敗しました。時間をおいて再試行してください。" };
  }
  const parsed = XIdRequestResultSchema.safeParse(response.data);
  return parsed.success ? parsed.data : { ok: false };
}

export function createXidRequestsApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): XidRequestsApi {
  return {
    requestLink: (xId) => write(fetchFn, "/api/xid/requests", { request_type: "link", x_id: xId }),
    requestMerge: (source, target) =>
      write(fetchFn, "/api/xid/requests", { request_type: "merge", x_id: source, target_x_user_id: target }),
    cancelRequest: (id) =>
      write(fetchFn, `/api/xid/requests/${encodeURIComponent(id)}/cancel`),
    requestMergeRevert: (id) =>
      write(fetchFn, "/api/xid/merge-revert-requests", { parent_request_id: id }),
  };
}
