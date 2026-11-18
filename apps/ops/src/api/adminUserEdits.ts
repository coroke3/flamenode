/** MIG-0731 U02b: JSON-only Ops adapter to existing atomic admin user writes. */
import { AdminOpsResultSchema, type AdminOpsResult } from "@flamenode/contracts";
import { send, type OpsWriteResult } from "./write.js";
import type { OpsFetch } from "./read.js";

export type UserAdminRole = "user" | "moderator" | "admin";
export type AdminGuardedWriteResult<T extends { ok: boolean }> =
  OpsWriteResult<T> | { status: "forbidden" };
export type UserEditResult = AdminGuardedWriteResult<AdminOpsResult>;

/**
 * Keep generic Ops send() untouched (MIG-0707 ownership). A privileged 403
 * must invalidate the mounted admin view even when its body says {ok:false}
 * or is not JSON. Other 4xx application errors retain their message.
 */
export async function sendAdminGuardedWrite<T extends { ok: boolean }>(
  fetchFn: OpsFetch,
  method: "POST" | "PUT",
  path: string,
  body: object,
): Promise<AdminGuardedWriteResult<T>> {
  let forbidden = false;
  const result = await send<T>(async (url, init) => {
    const response = await fetchFn(url, init);
    if (response.status === 403) forbidden = true;
    return response;
  }, method, path, body);
  return forbidden ? { status: "forbidden" } : result;
}

export function createAdminUserEditMutations(fetchFn: OpsFetch = (path, init) => fetch(path, init)) {
  const write = async (path: string, body: object): Promise<UserEditResult> => {
    const result = await sendAdminGuardedWrite<AdminOpsResult>(fetchFn, "POST", path, body);
    if (result.status !== "ok") return result;
    const parsed = AdminOpsResultSchema.safeParse(result.data);
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
  };
  const userPath = (id: string, action: string) =>
    "/api/admin/users/" + encodeURIComponent(id) + "/" + action;
  return {
    setRole: (id: string, role: UserAdminRole) =>
      id ? write(userPath(id, "role"), { role }) : Promise.resolve({ status: "unavailable" } as const),
    setBanned: (id: string, is_banned: 0 | 1, reason?: string) =>
      !id || (is_banned === 1 && !reason?.trim())
        ? Promise.resolve({ status: "unavailable" } as const)
        : write(userPath(id, "banned"), is_banned === 1 ? { is_banned, reason } : { is_banned }),
    setNotifications: (id: string, is_notification_enabled: 0 | 1) =>
      id ? write(userPath(id, "notifications"), { is_notification_enabled })
        : Promise.resolve({ status: "unavailable" } as const),
    setCanCreateEvents: (id: string, can_create_events: 0 | 1) =>
      id ? write(userPath(id, "can-create-events"), { can_create_events })
        : Promise.resolve({ status: "unavailable" } as const),
    refreshXIcon: (xId: string) =>
      xId ? write("/api/admin/x-users/" + encodeURIComponent(xId) + "/icon-refresh", {})
        : Promise.resolve({ status: "unavailable" } as const),
  };
}
