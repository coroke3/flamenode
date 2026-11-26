// D-16-1 provisional: replace with @flamenode/contracts at merge
/** MIG-0725 U03: pending X ID link requests and unmounted SA-090/091 transport. */
import { ManageXLinkRequestsResponseSchema, type ManageXLinkRequestsResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

/** Server-side manageGate is the authority. A 404 must never reveal request contents. */
export async function readManageXLinkRequests(
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<ManageXLinkRequestsResponse>> {
  const result = await getJson<unknown>(fetchFn, "/api/manage/x-link-requests", signal);
  if (result.status !== "ok") return result;
  const parsed = ManageXLinkRequestsResponseSchema.safeParse(result.data);
  // An ill-formed 200 response is not permission to render partial request records.
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

/** Provisional SA-090/091 result; matches MIG-0605's strict XIdLinkReviewResultSchema. */
export type XIdLinkReviewResult = { ok: boolean; message?: string };

function isReviewResult(value: unknown): value is XIdLinkReviewResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(data, "ok") &&
    typeof data.ok === "boolean" &&
    Object.keys(data).every((key) => key === "ok" || key === "message") &&
    (data.message === undefined || typeof data.message === "string");
}

/**
 * Contract-first only. No mounted caller until MIG-0605 completes.
 * The API must authorize xid.link_requests and enforce its own CAS/audit.
 * Request identity belongs exclusively to the URL (D-16-1).
 */
async function reviewXIdLinkRequest(
  fetchFn: OpsFetch,
  requestId: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<OpsWriteResult<XIdLinkReviewResult>> {
  const id = requestId.trim();
  if (!id) return { status: "ok", data: { ok: false, message: "申請 ID がありません。" } };
  // Literal dot segments are normalized by URL parsers, even when percent-encoded.
  if (id === "." || id === "..") return { status: "unavailable" };
  try {
    const path = "/api/xid/link-requests/" + encodeURIComponent(id) + "/" + action;
    const body = action === "approve" ? {} : { reason: (reason ?? "").trim().slice(0, 500) };
    const result = await send<XIdLinkReviewResult>(fetchFn, "POST", path, body);
    if (result.status !== "ok") return result;
    if (!isReviewResult(result.data)) return { status: "unavailable" };
    return { status: "ok", data: { ok: result.data.ok, ...(result.data.message === undefined ? {} : { message: result.data.message }) } };
  } catch {
    return { status: "unavailable" };
  }
}

export function approveXIdLinkRequest(
  fetchFn: OpsFetch, requestId: string,
): Promise<OpsWriteResult<XIdLinkReviewResult>> {
  return reviewXIdLinkRequest(fetchFn, requestId, "approve");
}

export function rejectXIdLinkRequest(
  fetchFn: OpsFetch, requestId: string, reason?: string,
): Promise<OpsWriteResult<XIdLinkReviewResult>> {
  return reviewXIdLinkRequest(fetchFn, requestId, "reject", reason);
}
