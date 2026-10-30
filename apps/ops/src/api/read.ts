/** MIG-0707 U05 (D-17-2): read-only Ops API response mapping, never authorization. */
export type OpsResult<T> =
  | { status: "ok"; data: T }
  | { status: "anonymous" }
  | { status: "forbidden"; redirect?: string; reason?: string }
  | { status: "notFound" }
  | { status: "unsupported" }
  | { status: "unavailable" };

export type OpsFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(
  fetchFn: OpsFetch,
  path: string,
  signal?: AbortSignal,
): Promise<OpsResult<T>> {
  try {
    const response = await fetchFn(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 404) return { status: "notFound" };
    if (response.status === 501) return { status: "unsupported" };
    if (response.status !== 200 && response.status !== 403) {
      return { status: "unavailable" };
    }
    const body: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 200) return { status: "ok", data: body as T };
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { status: "unavailable" };
    }
    const payload = body as Record<string, unknown>;
    return {
      status: "forbidden",
      ...(typeof payload.redirect === "string" ? { redirect: payload.redirect } : {}),
      ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    };
  } catch {
    return { status: "unavailable" };
  }
}
