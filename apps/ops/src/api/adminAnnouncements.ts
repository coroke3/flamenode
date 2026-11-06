/**
 * MIG-0727 U02a: CURRENT admin announcement list reads, no mutations.
 * Authorization belongs to the existing Hono admin-read route, not this adapter.
 */
import {
  AdminAnnouncementListResponseSchema,
  type AdminAnnouncementListResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
export type AnnouncementAudience = "any" | "all" | "creators" | "admins";
export type AnnouncementStatus = "any" | "published" | "draft";

export function announcementQuery(values: URLSearchParams): string {
  const audience = values.get("audience");
  const status = values.get("status");
  const normalizedAudience: AnnouncementAudience =
    audience === "all" || audience === "creators" || audience === "admins" ? audience : "any";
  const normalizedStatus: AnnouncementStatus =
    status === "published" || status === "draft" ? status : "any";
  return new URLSearchParams({ audience: normalizedAudience, status: normalizedStatus }).toString();
}

export async function readAdminAnnouncements(
  values: URLSearchParams,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminAnnouncementListResponse>> {
  const result = await getJson<unknown>(
    fetchFn, "/api/admin-read/announcements?" + announcementQuery(values), signal,
  );
  if (result.status !== "ok") return result;
  const parsed = AdminAnnouncementListResponseSchema.safeParse(result.data);
  return parsed.success && parsed.data.items.length <= 50
    ? { status: "ok", data: parsed.data }
    : { status: "unavailable" };
}

const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});
const jstDateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

export function formatAnnouncementUnix(value: number | null, dateOnly = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) return "—";
  return (dateOnly ? jstDate : jstDateTime).format(date);
}
