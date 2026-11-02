const REQUEST_TIMEOUT_MS = 5_000;
function requestSignal(signal) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseAccountSummary(value) {
    if (!isRecord(value))
        return { status: "unavailable" };
    if (value.loggedIn === false) {
        if (value.unavailable === true)
            return { status: "unavailable" };
        return value.unavailable === undefined ? { status: "anonymous" } : { status: "unavailable" };
    }
    if (value.loggedIn !== true ||
        (value.role !== "admin" && value.role !== "user" && value.role !== "moderator") ||
        typeof value.canAccessAdmin !== "boolean" ||
        typeof value.canAccessManage !== "boolean" ||
        // Never treat inconsistent or future degraded metadata as a healthy permission read.
        (value.degradedReason !== undefined && value.degraded !== true)) {
        return { status: "unavailable" };
    }
    // Unknown degradedReason is deliberately not trusted; guard fails closed.
    return { status: "ok", summary: {
            loggedIn: true,
            role: value.role,
            canAccessAdmin: value.canAccessAdmin,
            canAccessManage: value.canAccessManage,
            ...(value.degraded === true ? { degraded: true } : {}),
            ...(value.degradedReason === "pending_requests_unavailable" ||
                value.degradedReason === "management_access_unavailable"
                ? { degradedReason: value.degradedReason } : {}),
        } };
}
export function createOpsApi(fetchFn = (input, init) => fetch(input, init)) {
    async function get(path, signal) {
        return fetchFn(path, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json" },
            signal: requestSignal(signal),
        });
    }
    return {
        async getSummary(signal) {
            try {
                const response = await get("/api/account/summary", signal);
                if (response.status !== 200)
                    return { status: "unavailable" };
                return parseAccountSummary(await response.json());
            }
            catch {
                return { status: "unavailable" };
            }
        },
        async checkManageNavigation(signal) {
            try {
                const response = await get("/api/manage/navigation", signal);
                if (response.status === 401)
                    return "anonymous";
                if (response.status === 403) {
                    const body = await response.json();
                    return isRecord(body) && body.reason === "manage_access_required" ? "deny" : "unavailable";
                }
                if (response.status !== 200)
                    return "unavailable";
                const body = await response.json();
                if (!isRecord(body) || !isRecord(body.access))
                    return "unavailable";
                return body.access.canAccessAdmin === true || body.access.canAccessManage === true
                    ? "allow" : "unavailable";
            }
            catch {
                return "unavailable";
            }
        },
    };
}
