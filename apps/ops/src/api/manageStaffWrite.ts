// D-16-1 provisional MIG-0723 U02: replace request DTOs with MIG-0654
// @flamenode/contracts/manageStaffWrite after its independently reviewed merge.
import type { OpsFetch } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

export interface StaffMutationResult {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
}

/** FormData keys and flag representation are preserved from CURRENT SA-031. */
export interface StaffUpsertInput {
  x_user_id: string;
  display_name: string;
  permission_preset: string;
  permission_keys: string;
  is_public: "0" | "1";
  public_role_label: string;
  reason: string;
  confirm_text?: string;
}

/** Source eventStaffCsv row, including its original line number and preview metadata. */
export interface StaffCsvImportRow {
  lineNumber: number;
  display_name: string;
  x_user_id: string;
  permission_preset: string;
  permission_keys: string[];
  is_public_staff: "0" | "1";
  public_role_label: string;
  action: "create" | "update";
  errors: string[];
  warnings: string[];
}

export interface StaffTransferInput {
  from_staff_id: string;
  to_staff_id: string;
  reason: string;
  confirm_text: string;
  self_confirm_text: string;
}

type Outcome = OpsWriteResult<StaffMutationResult>;

function segment(value: string): string | null {
  // Reject missing and relative path segments before invoking fetch. Do not
  // interpret IDs as URLs; preserve whitespace in valid IDs by encoding it.
  if (!value || value === "." || value === ".." || value.includes("\0")) return null;
  try { return encodeURIComponent(value); }
  catch { return null; }
}

function basePath(eventId: string): string | null {
  const id = segment(eventId);
  return id === null ? null : "/api/manage/events/" + id;
}

const UNAVAILABLE: Outcome = { status: "unavailable" };

/**
 * Shared send() maps a JSON {ok:boolean} before inspecting HTTP status.
 * Never accept an attacker-controlled / proxied {ok:true} on 401/403/5xx
 * as a successful privileged staff mutation. Preserve 400/409/422
 * {ok:false,message} so CURRENT can display conflict/validation details.
 */
async function sendStaff(
  fetchFn: OpsFetch,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body: object,
): Promise<Outcome> {
  let httpStatus: number | null = null;
  const result = await send<StaffMutationResult>(async (url, init) => {
    const response = await fetchFn(url, init);
    httpStatus = response.status;
    return response;
  }, method, path, body);
  if (httpStatus === 401) return { status: "anonymous" };
  if (httpStatus === null) return UNAVAILABLE;
  if (httpStatus >= 200 && httpStatus < 300) return result;
  if ([400, 409, 422].includes(httpStatus) &&
      result.status === "ok" && result.data.ok === false) return result;
  return UNAVAILABLE;
}

/**
 * This is a provisional transport adapter only; the Hono API remains the sole
 * authority for permission, self-change and last-owner CAS validation.
 * No mutation route is mounted in MIG-0723 U02.
 */
export function createManageStaffWriteClient(fetchFn: OpsFetch = (path, init) => fetch(path, init)) {
  return {
    create(eventId: string, input: StaffUpsertInput): Promise<Outcome> {
      const path = basePath(eventId);
      if (!path || !input.reason.trim()) return Promise.resolve(UNAVAILABLE);
      return sendStaff(fetchFn, "POST", path + "/staff", input);
    },
    update(eventId: string, staffId: string, input: StaffUpsertInput): Promise<Outcome> {
      const path = basePath(eventId), staff = segment(staffId);
      if (!path || !staff || !input.reason.trim()) return Promise.resolve(UNAVAILABLE);
      return sendStaff(fetchFn, "PUT", path + "/staff/" + staff, input);
    },
    remove(eventId: string, staffId: string, reason: string, confirmText: string): Promise<Outcome> {
      const path = basePath(eventId), staff = segment(staffId);
      if (!path || !staff || !reason.trim()) return Promise.resolve(UNAVAILABLE);
      return sendStaff(fetchFn, "DELETE", path + "/staff/" + staff, {
        reason, confirm_text: confirmText,
      });
    },
    importCsv(eventId: string, reason: string, rows: readonly StaffCsvImportRow[]): Promise<Outcome> {
      const path = basePath(eventId);
      // Never submit a CSV preview known to contain errors; the server still
      // validates every row, permissions and atomicity independently.
      if (!path || !reason.trim() || rows.some(row => row.errors.length > 0))
        return Promise.resolve(UNAVAILABLE);
      return sendStaff(fetchFn, "POST", path + "/staff/csv", { reason, rows: [...rows] });
    },
    transferOwnership(eventId: string, input: StaffTransferInput): Promise<Outcome> {
      const path = basePath(eventId);
      if (!path || !segment(input.from_staff_id) || !segment(input.to_staff_id) ||
          !input.reason.trim() || !input.confirm_text.trim()) return Promise.resolve(UNAVAILABLE);
      return sendStaff(fetchFn, "POST", path + "/owner-transfer", input);
    },
  };
}
