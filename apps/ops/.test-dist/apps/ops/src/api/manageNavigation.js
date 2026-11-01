import { ManageNavigationResponseSchema } from "@flamenode/contracts";
import { getJson } from "./read.js";
export async function loadManageNavigation(fetchFn, signal) {
    const response = await getJson(fetchFn, "/api/manage/navigation", signal);
    if (response.status !== "ok")
        return response;
    const parsed = ManageNavigationResponseSchema.safeParse(response.data);
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
