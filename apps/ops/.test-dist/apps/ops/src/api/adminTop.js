import { getJson } from "./read.js";
export const EMPTY_ADMIN_TOP = {
    counts: {
        pendingVideos: 0, reservedOpenSlots: 0, xLinkRequests: 0, xMergeRequests: 0, xMergeReverts: 0,
        notificationFailed: 0, notificationStuck: 0, youtubeFailed: 0, moderationOpen: 0, moderationOverdue: 0,
    },
    mode: "normal",
    isMaintenance: 0,
};
function num(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
/** CURRENT falls back to empty counts / mode normal when the snapshot cannot be read. */
export function parseAdminTop(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return EMPTY_ADMIN_TOP;
    const body = value;
    const counts = (body.counts !== null && typeof body.counts === "object" ? body.counts : {});
    return {
        counts: {
            pendingVideos: num(counts.pendingVideos),
            reservedOpenSlots: num(counts.reservedOpenSlots),
            xLinkRequests: num(counts.xLinkRequests),
            xMergeRequests: num(counts.xMergeRequests),
            xMergeReverts: num(counts.xMergeReverts),
            notificationFailed: num(counts.notificationFailed),
            notificationStuck: num(counts.notificationStuck),
            youtubeFailed: num(counts.youtubeFailed),
            moderationOpen: num(counts.moderationOpen),
            moderationOverdue: num(counts.moderationOverdue),
        },
        mode: typeof body.mode === "string" && body.mode ? body.mode : "normal",
        isMaintenance: num(body.isMaintenance) ? 1 : 0,
    };
}
export async function fetchAdminTop(fetchFn, signal) {
    const result = await getJson(fetchFn, "/api/admin-read/ops/top", signal);
    return result.status === "ok" ? { status: "ok", data: parseAdminTop(result.data) } : result;
}
/** D-17-2: /api/admin-read/* 401 -> /entry, 403 -> the allow-listed body redirect, else /dashboard. */
export function adminReadRedirect(result) {
    if (result.status === "anonymous")
        return "/entry";
    if (result.status === "forbidden")
        return result.redirect ?? "/dashboard";
    return null;
}
/** CURRENT page: trim both inputs (page.tsx:17-18). */
export function normalizeSimulatorQuery(params) {
    return {
        eventId: (params.get("event_id") ?? "").trim(),
        xUserId: (params.get("x_user_id") ?? "").trim(),
    };
}
function isSimulatorBody(value) {
    if (value === null || typeof value !== "object")
        return false;
    const result = value.result;
    if (result === null)
        return true;
    if (typeof result !== "object")
        return false;
    const r = result;
    const strings = (x) => Array.isArray(x) && x.every((v) => typeof v === "string");
    const nullableString = (x) => x === null || typeof x === "string";
    return typeof r.found === "boolean" && typeof r.eventId === "string" && nullableString(r.xUserId)
        && nullableString(r.displayName) && nullableString(r.preset) && nullableString(r.presetLabel)
        && strings(r.resolvedKeys) && strings(r.resolvedLabels) && Array.isArray(r.spotlight)
        && r.spotlight.every((e) => e !== null && typeof e === "object" && typeof e.key === "string"
            && typeof e.label === "string" && typeof e.allowed === "boolean");
}
/** T04: when either input is empty the API is not called and there is no result. */
export async function fetchPermissionSimulator(fetchFn, query, signal) {
    if (!query.eventId || !query.xUserId) {
        return { status: "ok", data: { eventId: query.eventId, xUserId: query.xUserId, result: null } };
    }
    const qs = new URLSearchParams({ event_id: query.eventId, x_user_id: query.xUserId });
    const result = await getJson(fetchFn, "/api/admin-read/permissions/simulator?" + qs.toString(), signal);
    if (result.status !== "ok")
        return result;
    if (!isSimulatorBody(result.data))
        return { status: "unavailable" };
    return result;
}
