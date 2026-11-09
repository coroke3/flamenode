/** MIG-0709: consume the merged MIG-0659 response contract; never infer success from HTTP 2xx alone. */
import { XIdRequestResultSchema, type XIdRequestResult } from "@flamenode/contracts";

export type XidRequestResult = XIdRequestResult;

export interface XidRequestsApi {
  requestLink(xId: string): Promise<XidRequestResult>;
  requestMerge(sourceXId: string, targetXUserId: string): Promise<XidRequestResult>;
  cancelRequest(requestId: string): Promise<XidRequestResult>;
  requestMergeRevert(parentRequestId: string): Promise<XidRequestResult>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function write(
  fetchFn: FetchLike,
  path: string,
  payload: Record<string, string>,
): Promise<XidRequestResult> {
  const res = await fetchFn(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false };
  }
  // The shared MIG-0659 schema rejects malformed responses without treating 2xx as success.
  const parsed = XIdRequestResultSchema.safeParse(data);
  if (!parsed.success) return { ok: false };
  if (!res.ok) return { ok: false, message: parsed.data.message };
  return parsed.data;
}

export function createXidRequestsApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): XidRequestsApi {
  return {
    requestLink: (xId) => write(fetchFn, "/api/xid/requests", { request_type: "link", x_id: xId }),
    requestMerge: (source, target) =>
      write(fetchFn, "/api/xid/requests", { request_type: "merge", x_id: source, target_x_user_id: target }),
    cancelRequest: (id) =>
      write(fetchFn, `/api/xid/requests/${encodeURIComponent(id)}/cancel`, {}),
    requestMergeRevert: (id) =>
      write(fetchFn, "/api/xid/merge-revert-requests", { parent_request_id: id }),
  };
}
