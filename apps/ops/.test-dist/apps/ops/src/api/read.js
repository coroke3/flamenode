/** A 403 body cannot choose an arbitrary URL for a privileged Ops navigation. */
const FORBIDDEN_REDIRECTS = new Set([
    "/dashboard",
    "/entry",
    "/onboarding",
    "/entry?error=auth_temporarily_unavailable",
]);
export async function getJson(fetchFn, path, signal) {
    try {
        const response = await fetchFn(path, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json" },
            signal,
        });
        if (signal?.aborted)
            return { status: "unavailable" };
        if (response.status === 401)
            return { status: "anonymous" };
        if (response.status === 404)
            return { status: "notFound" };
        if (response.status === 501)
            return { status: "unsupported" };
        // Authorization failure is authoritative even when its optional JSON body is
        // truncated or malformed. Turning a 403 into "unavailable" would allow the
        // same-key refresh cache to keep displaying previously private content.
        if (response.status === 403) {
            let body = null;
            try {
                body = await response.json();
            }
            catch { /* optional error body */ }
            if (signal?.aborted)
                return { status: "unavailable" };
            if (body === null || typeof body !== "object" || Array.isArray(body)) {
                return { status: "forbidden" };
            }
            const payload = body;
            return {
                status: "forbidden",
                ...(typeof payload.redirect === "string" && FORBIDDEN_REDIRECTS.has(payload.redirect)
                    ? { redirect: payload.redirect } : {}),
                ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
            };
        }
        if (response.status !== 200)
            return { status: "unavailable" };
        const body = await response.json();
        if (signal?.aborted)
            return { status: "unavailable" };
        return { status: "ok", data: body };
    }
    catch {
        return { status: "unavailable" };
    }
}
