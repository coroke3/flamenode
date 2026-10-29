// MIG-0719 provisional contract until MIG-0661 is DONE on main.
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
export type OperationMode = "normal" | "economy" | "read_only" | "static_only" | "maintenance";
export type OperationModeBanner = { mode: OperationMode; reason: string | null };
const MODES: readonly string[] = ["normal", "economy", "read_only", "static_only", "maintenance"];
export async function loadOperationMode(fetchFn: OpsFetch, signal?: AbortSignal): Promise<OpsResult<OperationModeBanner>> {
  const result = await getJson<unknown>(fetchFn, "/api/operation-mode/banner", signal);
  if (result.status !== "ok") return result;
  const value = result.data;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { status: "unavailable" };
  const record = value as Record<string, unknown>;
  if (typeof record.mode !== "string" || !MODES.includes(record.mode) ||
      !(record.reason === null || typeof record.reason === "string")) return { status: "unavailable" };
  return { status: "ok", data: { mode: record.mode as OperationMode, reason: record.reason as string | null } };
}
