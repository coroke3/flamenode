// MIG-0723 U01a: CURRENT manage staff page read-side adapter (read only).
import { ManageStaffResponseSchema, type ManageStaffResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** API authorization is always enforced by Hono; this parser is only for safe rendering. */
export async function readManageStaff(
  eventId: string,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
  signal?: AbortSignal,
): Promise<OpsResult<ManageStaffResponse>> {
  if (!eventId || eventId === "." || eventId === "..") {
    return { status: "unavailable" };
  }
  const response = await getJson<unknown>(
    fetchFn,
    "/api/manage/events/" + encodeURIComponent(eventId) + "/staff",
    signal,
  );
  if (response.status !== "ok") return response;
  // A zod failure must not render untrusted or partial member data.
  const parsed = ManageStaffResponseSchema.safeParse(response.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
