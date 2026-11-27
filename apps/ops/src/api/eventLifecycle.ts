// MIG-0721 U02a: read-only Manage EventEdit boundary, staged TEST_ONLY until a real consumer mounts.
import { ManageEventEditResponseSchema, type ManageEventEditResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** Preserve the server-resolved access snapshot; parsing is not authorization. */
export async function readManageEventEdit(
  eventId: string,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
  signal?: AbortSignal,
): Promise<OpsResult<ManageEventEditResponse>> {
  if (!eventId || eventId === "." || eventId === ".." || eventId.includes("\0")) {
    return { status: "unavailable" };
  }
  // Dot segments can change the requested path; malformed UTF-16 must never
  // reject the read promise or reach the network. Preserve other opaque IDs.
  let encodedId: string;
  try {
    encodedId = encodeURIComponent(eventId);
  } catch {
    return { status: "unavailable" };
  }
  const response = await getJson<unknown>(
    fetchFn,
    "/api/manage/events/" + encodedId + "/edit",
    signal,
  );
  if (response.status !== "ok") return response;
  const parsed = ManageEventEditResponseSchema.safeParse(response.data);
  return parsed.success && parsed.data.initial.id === eventId
    ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
