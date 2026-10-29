/** Public same-origin JSON transport for Phase 5 browser Islands (MIG-0510 U03).
 * A 503 or non-JSON response must not be mistaken for an empty public dataset.
 */
export type PublicJsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number };

export async function fetchPublicJson<T>(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<PublicJsonResult<T>> {
  // Do not allow API callers to turn credentialed fetch into an external request.
  if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(path) || path.includes("://")) {
    return { ok: false, status: 0 };
  }
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const response = await fetcher(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: response.status };
    if (!(response.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) {
      return { ok: false, status: 0 };
    }
    const data: T = await response.json();
    return { ok: true, data, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
