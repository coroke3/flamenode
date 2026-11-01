/** MIG-0707 U05 (D-17-3 / D-16-2): CURRENT-compatible mutation result mapping. */
import type { OpsFetch } from "./read.js";

export type OpsWriteResult<T extends { ok: boolean }> =
  | { status: "ok"; data: T }
  | { status: "anonymous" }
  | { status: "unavailable" };

export async function send<T extends { ok: boolean }>(
  fetchFn: OpsFetch,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: object | FormData,
): Promise<OpsWriteResult<T>> {
  const formData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { accept: "application/json" };
  if (!formData) headers["content-type"] = "application/json";
  try {
    const response = await fetchFn(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: formData ? body : JSON.stringify(body) }),
    });
    const payload: unknown = await response.json();
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload) &&
        typeof (payload as Record<string, unknown>).ok === "boolean") {
      return { status: "ok", data: payload as T };
    }
    if (response.status === 401) return { status: "anonymous" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
