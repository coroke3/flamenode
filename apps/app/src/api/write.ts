/**
 * MIG-0710 U01 / D-16-2: shared Personal SPA mutation transport.
 * A JSON error envelope with {ok:false} is still a parsed result: callers
 * display the server's message instead of misclassifying it as a network loss.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type WriteResult<T extends { ok: boolean }> =
  | { status: "ok"; data: T }
  | { status: "anonymous" }
  | { status: "unavailable" };

export async function send<T extends { ok: boolean }>(
  fetchFn: FetchLike,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: object | FormData,
): Promise<WriteResult<T>> {
  const isFormData = body instanceof FormData;
  const headers: Record<string, string> = { accept: "application/json" };
  // Multipart content-type must be generated with the FormData boundary.
  if (!isFormData) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetchFn(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) }),
    });
  } catch {
    return { status: "unavailable" };
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return response.status === 401 ? { status: "anonymous" } : { status: "unavailable" };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean"
  ) {
    return { status: "ok", data: value as T };
  }
  return response.status === 401 ? { status: "anonymous" } : { status: "unavailable" };
}
