// MIG-0732 U02a: authorized read-only X ID merge/revert views; mutations wait for MIG-0644.
import { AdminXIdMergesResponseSchema, type AdminXIdMergesResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type XMergeView = "requests" | "reverts";
export const X_MERGE_LIMITS = { requests: 50, reverts: 100, preview: 51 } as const;
const READ_PATH = "/api/admin-read/x-id-merges";

/** Match the Hono reader's clamp, never allow arbitrary query keys or IDs. */
export function xMergeReadPath(view: XMergeView, impact = ""): string {
  if (view === "reverts") return READ_PATH + "?view=reverts";
  const selected = impact.trim().slice(0, 128);
  return selected ? READ_PATH + "?impact=" + encodeURIComponent(selected) : READ_PATH;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Check API-level identifiers and bounds before rendering protected admin data. */
export function validXMergeSnapshot(data: AdminXIdMergesResponse, view: XMergeView, impact: string): boolean {
  const selected = view === "requests" ? impact.trim().slice(0, 128) : "";
  if (data.view !== view || data.selectedImpactId !== selected ||
      data.requests.length > X_MERGE_LIMITS.requests ||
      data.reverts.length > X_MERGE_LIMITS.reverts ||
      !validCount(data.now)) return false;
  if (view === "reverts" && data.requests.length !== 0) return false;
  if (view === "requests" && data.reverts.length !== 0) return false;
  const ids = new Set<string>();
  for (const row of data.requests) {
    if (!row.id || ids.has(row.id)) return false;
    ids.add(row.id);
    if (!validCount(row.updated_at) || row.impact.length > 13 ||
        row.preview.length > X_MERGE_LIMITS.preview) return false;
    const eligible = row.id === selected && !!row.source_x_user_id &&
      (row.status === "pending" || row.status === "approved");
    if (!eligible && (row.impact.length !== 0 || row.preview.length !== 0)) return false;
    if (!row.impact.every(item => validCount(item.count)) ||
        !row.preview.every(item => [item.creator_change, item.member_rows, item.chapter_rows,
          item.slot_rows, item.interaction_rows, item.moderation_rows].every(validCount))) return false;
  }
  if (new Set(data.reverts.map(row => row.id)).size !== data.reverts.length) return false;
  return data.reverts.every(row => !!row.id);
}

export function createXIdMergesApi(fetchFn: OpsFetch) {
  return {
    async get(view: XMergeView, impact = "", signal?: AbortSignal): Promise<OpsResult<AdminXIdMergesResponse>> {
      const response = await getJson<unknown>(fetchFn, xMergeReadPath(view, impact), signal);
      if (response.status !== "ok") return response;
      const parsed = AdminXIdMergesResponseSchema.safeParse(response.data);
      if (!parsed.success || !validXMergeSnapshot(parsed.data, view, impact)) {
        return { status: "unavailable" };
      }
      return { status: "ok", data: parsed.data };
    },
  };
}
export type XIdMergesApi = ReturnType<typeof createXIdMergesApi>;
