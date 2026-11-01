// MIG-0719 provisional contract until MIG-0661 is DONE on main.
import { getJson } from "./read.js";
const MODES = ["normal", "economy", "read_only", "static_only", "maintenance"];
export async function loadOperationMode(fetchFn, signal) {
    const result = await getJson(fetchFn, "/api/operation-mode/banner", signal);
    if (result.status !== "ok")
        return result;
    const value = result.data;
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return { status: "unavailable" };
    const record = value;
    if (typeof record.mode !== "string" || !MODES.includes(record.mode) ||
        !(record.reason === null || typeof record.reason === "string"))
        return { status: "unavailable" };
    return { status: "ok", data: { mode: record.mode, reason: record.reason } };
}
