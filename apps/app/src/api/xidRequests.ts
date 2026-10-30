/**
 * MIG-0709 provisional client contract (D-16-1).
 * Replace the response parsing with packages/contracts/src/xidRequest.ts only after
 * MIG-0659 is DONE. Do not infer success from HTTP 2xx alone.
 */
export interface XidRequestResult {
  ok: boolean;
  message?: string;
}

export interface XidRequestsApi {
  requestLink(xId: string): Promise<XidRequestResult>;
  requestMerge(sourceXId: string, targetXUserId: string): Promise<XidRequestResult>;
  cancelRequest(requestId: string): Promise<XidRequestResult>;
  requestMergeRevert(parentRequestId: string): Promise<XidRequestResult>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isResult(value: unknown): value is XidRequestResult {
  return typeof value === "object" && value !== null
    && "ok" in value && typeof value.ok === "boolean"
    && (!("message" in value) || value.message === undefined || typeof value.message === "string");
}

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
  // The final schema belongs to MIG-0659. Reject malformed / success-shaped errors.
  if (!isResult(data)) return { ok: false };
  if (!res.ok) return { ok: false, message: data.message };
  return data;
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
