/** MIG-0736 U01: validated, read-only Admin diagnostics adapter. Role checks live in Hono/OpsGate. */
import {
  AdminHealthResponseSchema,
  AdminWorkersResponseSchema,
  AdminIntegrityResponseSchema,
  AdminSecurityResponseSchema,
  type AdminHealthResponse,
  type AdminWorkersResponse,
  type AdminIntegrityResponse,
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

// Diagnostic-specific receipt outcome. "ok" on OpsResult means the transport
// delivered a receipt, not that the diagnostic is valid. The explicit local
// marker replaces obsolete data in useApiResult without changing its shared
// same-key transport-failure retention or inventing a valid server DTO.
type InvalidDiagnosticReceipt = { readonly diagnosticError: "invalid_receipt" };
export type DiagnosticReceipt<T> = T | InvalidDiagnosticReceipt;

export function isInvalidDiagnosticReceipt(data: object): data is InvalidDiagnosticReceipt {
  return "diagnosticError" in data && data.diagnosticError === "invalid_receipt";
}

async function validatedDiagnosticRead<T>(
  fetchFn: OpsFetch,
  path: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  signal?: AbortSignal,
): Promise<OpsResult<DiagnosticReceipt<T>>> {
  let received200 = false;
  const result = await getJson<unknown>(async (input, init) => {
    const response = await fetchFn(input, init);
    received200 = response.status === 200;
    return response;
  }, path, signal);
  const invalidReceipt = (): OpsResult<DiagnosticReceipt<T>> =>
    ({ status: "ok", data: { diagnosticError: "invalid_receipt" } });

  // A 200 with an unreadable/incomplete body is not a fresh diagnosis.
  // A real pre-header network error or non-200 transient failure remains
  // unavailable. Do not turn cancellation into a diagnostic error.
  if (result.status === "unavailable" && received200 && !signal?.aborted) {
    return invalidReceipt();
  }
  if (result.status !== "ok") return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : invalidReceipt();
}

export function getAdminHealth(
  fetchFn: OpsFetch,
  deep: boolean,
  signal?: AbortSignal,
): Promise<OpsResult<DiagnosticReceipt<AdminHealthResponse>>> {
  return validatedDiagnosticRead(
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
): Promise<OpsResult<DiagnosticReceipt<AdminSecurityResponse>>> {
  // CURRENT does not perform any security check on the initial page.
  // Avoid even a no-op diagnostics request until the explicit run link is used.
  if (!run) {
    return Promise.resolve({
      status: "ok",
      data: { status: "all", ran: false, results: [], error: null },
    });
  }
  return validatedDiagnosticRead(
    fetchFn,
    "/api/admin-read/ops/security?run=1",
    AdminSecurityResponseSchema,
    signal,
  );
}

/** U02a: expose the existing bounded worker-monitor snapshot without client-side auth decisions. */
export function getAdminWorkers(
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminWorkersResponse>> {
  return validatedRead(fetchFn, "/api/admin-read/ops/workers", AdminWorkersResponseSchema, signal);
}

/** U02c: never run whole-table integrity scans without explicit run=1.
 * CURRENT backend responds 501 for run=1 until MIG-0626 finishes per-check routes.
 */
export function getAdminIntegrity(
  fetchFn: OpsFetch,
  run: boolean,
  signal?: AbortSignal,
): Promise<OpsResult<AdminIntegrityResponse>> {
  if (!run) return Promise.resolve({ status: "ok", data: { ran: false, results: [] } });
  return validatedRead(fetchFn, "/api/admin-read/ops/integrity?run=1", AdminIntegrityResponseSchema, signal);
}
