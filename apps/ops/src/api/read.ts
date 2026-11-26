/** MIG-0707 U05 (D-17-2): read-only Ops API response mapping, never authorization. */
export type OpsResult<T> =
  | { status: "ok"; data: T }
  | { status: "anonymous" }
  | { status: "forbidden"; redirect?: string; reason?: string }
  | { status: "notFound" }
  | { status: "unsupported" }
  | { status: "unavailable" };

/** A 403 body cannot choose an arbitrary URL for a privileged Ops navigation. */
const FORBIDDEN_REDIRECTS = new Set([
  "/dashboard",
  "/entry",
  "/onboarding",
  "/entry?error=auth_temporarily_unavailable",
]);

export type OpsFetch = (input: string, init?: RequestInit) => Promise<Response>;

// A 403 is authoritative from its headers. Its optional redirect/reason body
// must not indefinitely delay a forbidden result when the response stream stalls.
const FORBIDDEN_BODY_DEADLINE_MS = 250;

async function readOptionalForbiddenBody(response: Response, signal?: AbortSignal): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), FORBIDDEN_BODY_DEADLINE_MS);
    if (signal) {
      onAbort = () => resolve(null);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) resolve(null);
    }
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => response.json()).catch(() => null),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

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
    // Authorization failure is authoritative even when its optional JSON body is
    // truncated or malformed. Turning a 403 into "unavailable" would allow the
    // same-key refresh cache to keep displaying previously private content.
    if (response.status === 403) {
      const body = await readOptionalForbiddenBody(response, signal);
      if (signal?.aborted) return { status: "unavailable" };
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { status: "forbidden" };
      }
      const payload = body as Record<string, unknown>;
      return {
        status: "forbidden",
        ...(typeof payload.redirect === "string" && FORBIDDEN_REDIRECTS.has(payload.redirect)
          ? { redirect: payload.redirect } : {}),
        ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
      };
    }
    if (response.status !== 200) return { status: "unavailable" };
    const body: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    return { status: "ok", data: body as T };
  } catch {
    return { status: "unavailable" };
  }
}
