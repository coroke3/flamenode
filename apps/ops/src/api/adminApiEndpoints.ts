/**
 * MIG-0727 U01: read-only admin API-endpoint list contract.
 * The server's /api/admin-read router enforces admin authorization and no-store;
 * client validation is a rendering guard, not an authorization boundary.
 */
import {
  AdminApiEndpointsResponseSchema,
  type AdminApiEndpointsResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

const MAX_ROWS = 100;
const READ_PATH = "/api/admin-read/api-endpoints";

export async function readAdminApiEndpoints(
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminApiEndpointsResponse>> {
  const result = await getJson<unknown>(fetchFn, READ_PATH, signal);
  if (result.status !== "ok") return result;

  const parsed = AdminApiEndpointsResponseSchema.safeParse(result.data);
  if (!parsed.success ||
      parsed.data.rows.length > MAX_ROWS ||
      parsed.data.eventOptions.length > MAX_ROWS) {
    return { status: "unavailable" };
  }
  return { status: "ok", data: parsed.data };
}

export type EventExportFormat = "v5" | "legacy";
export type EventExportUpdate = "realtime" | "scheduled";
export type EventExportRefresh = 15 | 60 | 360 | 1440;

/** Mirrors CURRENT EventExportLinkBuilder: omit format=v5 for legacy URL compatibility. */
export function eventExportHref(
  eventId: string,
  format: EventExportFormat = "v5",
  update: EventExportUpdate = "realtime",
  refresh: EventExportRefresh = 60,
): string {
  const params = new URLSearchParams({ update });
  if (format === "legacy") params.set("format", "legacy");
  if (update === "scheduled") params.set("refresh", String(refresh));
  return `/api/event-endpoints/${encodeURIComponent(eventId)}?${params.toString()}`;
}
