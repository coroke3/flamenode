import { ManageDashboardResponseSchema } from "@flamenode/contracts";
import { getJson } from "./read.js";
export async function loadManageDashboard(fetchFn, signal) {
    const response = await getJson(fetchFn, "/api/manage", signal);
    if (response.status !== "ok")
        return response;
    const parsed = ManageDashboardResponseSchema.safeParse(response.data);
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
