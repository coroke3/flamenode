export const X_IDENTITY_REQUEST_TYPES = [
  "new_link",
  "existing_link",
  "alias",
  "merge",
  "revert_merge",
] as const;

export type XIdentityRequestType = (typeof X_IDENTITY_REQUEST_TYPES)[number];

export type XIdentityRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "done"
  | "cancelled";

export interface XIdentityRequestShape {
  requestType: XIdentityRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  parentRequestId?: string | null;
  restoreSnapshotJson?: string | null;
  revertDeadlineAt?: number | null;
}

export interface XIdentityRequestRecord {
  id: string;
  request_type: XIdentityRequestType;
  requested_by_auth_user_id: string;
  requested_x_id: string | null;
  source_x_user_id: string | null;
  target_x_user_id: string | null;
  parent_request_id: string | null;
  restore_snapshot_json: string | null;
  revert_deadline_at: number | null;
  status: XIdentityRequestStatus;
  requested_at: number;
  updated_at: number;
}

export interface PublicXIdentityRequestDto {
  id: string;
  request_type: XIdentityRequestType;
  requested_x_id: string | null;
  source_x_user_id: string | null;
  target_x_user_id: string | null;
  status: XIdentityRequestStatus;
  requested_at: number;
  updated_at: number;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateXIdentityRequestShape(
  input: XIdentityRequestShape,
): string | null {
  switch (input.requestType) {
    case "new_link":
    case "existing_link":
      return hasText(input.requestedXId)
        ? null
        : `${input.requestType} には requested_x_id が必要です。`;
    case "alias":
      if (!hasText(input.requestedXId)) {
        return "alias には requested_x_id が必要です。";
      }
      return hasText(input.targetXUserId)
        ? null
        : "alias には target_x_user_id が必要です。";
    case "merge":
      if (!hasText(input.sourceXUserId) || !hasText(input.targetXUserId)) {
        return "merge には source_x_user_id と target_x_user_id が必要です。";
      }
      return input.sourceXUserId === input.targetXUserId
        ? "merge の source と target は別の X ID にしてください。"
        : null;
    case "revert_merge":
      if (!hasText(input.parentRequestId)) {
        return "revert_merge には parent_request_id が必要です。";
      }
      if (!hasText(input.restoreSnapshotJson)) {
        return "revert_merge には restore_snapshot_json が必要です。";
      }
      return Number.isInteger(input.revertDeadlineAt) &&
        Number(input.revertDeadlineAt) > 0
        ? null
        : "revert_merge には revert_deadline_at が必要です。";
  }
}

/**
 * 公開向けに申請情報を投影する。認証ユーザーID、親申請、復元JSON、期限は含めない。
 */
export function toPublicXIdentityRequestDto(
  row: XIdentityRequestRecord,
): PublicXIdentityRequestDto {
  return {
    id: row.id,
    request_type: row.request_type,
    requested_x_id: row.requested_x_id,
    source_x_user_id: row.source_x_user_id,
    target_x_user_id: row.target_x_user_id,
    status: row.status,
    requested_at: row.requested_at,
    updated_at: row.updated_at,
  };
}

export function isRevertDeadlineOpen(
  revertDeadlineAt: number | null | undefined,
  nowUnix: number,
): boolean {
  return Number.isInteger(revertDeadlineAt) && Number(revertDeadlineAt) >= nowUnix;
}

export function buildXIdentityDecisionFields(input: {
  decidedByAuthUserId: string;
  decisionReason?: string | null;
  decidedAt: number;
}) {
  return {
    decision_reason: input.decisionReason ?? null,
    decided_by_auth_user_id: input.decidedByAuthUserId,
    decided_at: input.decidedAt,
  };
}
