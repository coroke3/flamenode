/** MIG-0731 U01: Ops admin users query adapter. Authorization stays in Hono. */
import {
  AdminUsersResponseSchema,
  type AdminUsersResponse,
  type AdminUsersView,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type UsersTab = AdminUsersView | "links";
export type UsersQuery = {
  view?: string | null;
  q?: string | null;
  status?: string | null;
  page?: string | null;
};
export type UsersReadResult = OpsResult<AdminUsersResponse> |
  { status: "redirect"; to: "/admin/x-link-requests" };

/** CURRENT: unknown views map to discord; old view=links redirects. */
export function normalizeUsersTab(view?: string | null): UsersTab {
  if (view === "links") return "links";
  if (view === "xid" || view === "permissions") return view;
  return "discord";
}

/** Keep query keys and paging compatible with CURRENT; backend clamps the page. */
export function usersListPath(query: UsersQuery = {}): string {
  const params = new URLSearchParams();
  const view = normalizeUsersTab(query.view);
  params.set("view", view);
  if (view !== "permissions") {
    if (query.q) params.set("q", query.q);
    if (view === "discord" && query.status) params.set("status", query.status);
    if (query.page) params.set("page", query.page);
  }
  return "/api/admin-read/users?" + params.toString();
}

/** A malformed 200 response must never be rendered as a privileged user list. */
export function createAdminUsersApi(fetchFn: OpsFetch = (path, init) => fetch(path, init)) {
  return {
    async getUsers(query: UsersQuery = {}, signal?: AbortSignal): Promise<UsersReadResult> {
      if (normalizeUsersTab(query.view) === "links") {
        return { status: "redirect", to: "/admin/x-link-requests" };
      }
      const result = await getJson<unknown>(fetchFn, usersListPath(query), signal);
      if (result.status !== "ok") return result;
      const parsed = AdminUsersResponseSchema.safeParse(result.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
  };
}

/** Pagination preserves the CURRENT search and status filters. */
export function usersPageHref(query: UsersQuery, page: number): string {
  const params = new URLSearchParams();
  const view = normalizeUsersTab(query.view);
  params.set("view", view);
  if (query.q && view !== "permissions") params.set("q", query.q);
  if (query.status && view === "discord") params.set("status", query.status);
  params.set("page", String(page));
  return "/admin/users?" + params.toString();
}
