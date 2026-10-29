/** MIG-0736 U01: validated, read-only Admin diagnostics adapter. Role checks live in Hono/OpsGate. */
import {
  AdminHealthResponseSchema,
  AdminSecurityResponseSchema,
  type AdminHealthResponse,
  type AdminSecurityResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

async function validatedRead<T>(
  fetchFn: OpsFetch,
  path: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  signal?: AbortSignal,
): Promise<OpsResult<T>> {
  // getJson maps auth, 404, 501, cancellation and connection failures.
  // A 200 without a valid DTO must not be treated as a successful diagnostic.
  const result = await getJson<unknown>(fetchFn, path, signal);
  if (result.status !== "ok") return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

export function getAdminHealth(
  fetchFn: OpsFetch,
  deep: boolean,
  signal?: AbortSignal,
): Promise<OpsResult<AdminHealthResponse>> {
  return validatedRead(
    fetchFn,
    `/api/admin-read/ops/health${deep ? "?deep=1" : ""}`,
    AdminHealthResponseSchema,
    signal,
  );
}

export function getAdminSecurity(
  fetchFn: OpsFetch,
  run: boolean,
  signal?: AbortSignal,
): Promise<OpsResult<AdminSecurityResponse>> {
  // CURRENT does not perform any security check on the initial page.
  // Avoid even a no-op diagnostics request until the explicit run link is used.
  if (!run) {
    return Promise.resolve({
      status: "ok",
      data: { status: "all", ran: false, results: [], error: null },
    });
  }
  return validatedRead(
    fetchFn,
    "/api/admin-read/ops/security?run=1",
    AdminSecurityResponseSchema,
    signal,
  );
}
