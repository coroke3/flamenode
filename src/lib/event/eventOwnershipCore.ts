export type EventStaffPreset =
  | "owner"
  | "manager"
  | "slot_manager"
  | "content_editor"
  | "reviewer"
  | "xid_reviewer"
  | "public_staff"
  | "custom";

export type EventStaffRole = "representative" | "editor" | "staff";

export type EventStaffOwnershipRow = {
  id: string;
  event_id: string;
  user_id: string | null;
  x_user_id: string | null;
  permission_preset: string | null;
  role: string | null;
};

export const LAST_OWNER_ERROR =
  "イベントには最低1人の代表者が必要です。先に別のスタッフへ代表権限を移譲してください。";

export function isEventOwner(
  row: Pick<EventStaffOwnershipRow, "permission_preset">,
): boolean {
  return row.permission_preset === "owner";
}

/** 表示専用 role を permission_preset から一方向に同期する。 */
export function syncLegacyRoleFromPreset(
  preset: EventStaffPreset,
): EventStaffRole {
  if (preset === "owner") return "representative";
  if (preset === "manager") return "editor";
  return "staff";
}

export function validateEventStaffSubject(input: {
  userId: string | null | undefined;
  xUserId: string | null | undefined;
}): void {
  if (!input.userId?.trim() && !input.xUserId?.trim()) {
    throw new Error("スタッフには内部ユーザー ID または X ID が必要です。");
  }
}

export function validateEventStaffUniqueness(input: {
  rows: readonly EventStaffOwnershipRow[];
  candidate: Pick<EventStaffOwnershipRow, "id" | "event_id" | "user_id" | "x_user_id">;
}): void {
  const duplicate = input.rows.find((row) => {
    if (row.id === input.candidate.id || row.event_id !== input.candidate.event_id) {
      return false;
    }
    return (
      (!!input.candidate.user_id &&
        row.user_id === input.candidate.user_id) ||
      (!!input.candidate.x_user_id &&
        row.x_user_id === input.candidate.x_user_id)
    );
  });
  if (duplicate) {
    throw new Error("このイベントには同じスタッフ主体が既に登録されています。");
  }
}

export function assertEventWillRetainOwner(input: {
  owners: readonly EventStaffOwnershipRow[];
  target: EventStaffOwnershipRow;
  nextPreset: EventStaffPreset | null;
}): void {
  const removesOwner = isEventOwner(input.target) && input.nextPreset !== "owner";
  if (removesOwner && input.owners.length <= 1) {
    throw new Error(LAST_OWNER_ERROR);
  }
}

/**
 * X ID 統合で同一イベントのスタッフ主体が衝突したとき、削除される source owner
 * を既存の target 行へ移して最後の owner を失わないための計画を返す。
 */
export function planXIdMergeEventStaffOwnerProtection(input: {
  rows: readonly EventStaffOwnershipRow[];
  fromXUserId: string;
  toXUserId: string;
}): {
  collidedSourceStaffIds: readonly string[];
  promotedTargetStaffIds: readonly string[];
} {
  const targetsByEvent = new Map(
    input.rows
      .filter((row) => row.x_user_id === input.toXUserId)
      .map((row) => [row.event_id, row]),
  );
  const collidedSourceStaffIds: string[] = [];
  const promotedTargetStaffIds: string[] = [];
  for (const source of input.rows) {
    if (source.x_user_id !== input.fromXUserId) continue;
    const target = targetsByEvent.get(source.event_id);
    if (!target) continue;
    collidedSourceStaffIds.push(source.id);
    if (isEventOwner(source) && !isEventOwner(target)) {
      promotedTargetStaffIds.push(target.id);
    }
  }
  return {
    collidedSourceStaffIds,
    promotedTargetStaffIds,
  };
}

export function isActorTargetingSelf(input: {
  actorUserId: string;
  target: Pick<EventStaffOwnershipRow, "user_id" | "x_user_id">;
  approvedXIds: readonly string[];
}): boolean {
  if (input.target.user_id && input.target.user_id === input.actorUserId) {
    return true;
  }
  return !!input.target.x_user_id && input.approvedXIds.includes(input.target.x_user_id);
}

export function assertSelfChangeConfirmation(input: {
  eventId: string;
  isSelfTarget: boolean;
  removesMembership: boolean;
  losesMemberPermission: boolean;
  confirmText: string | null | undefined;
  reason: string | null | undefined;
}): void {
  if (!input.isSelfTarget) return;
  if (!input.reason?.trim()) {
    throw new Error("自分の権限を変更する理由を入力してください。");
  }
  const required = input.removesMembership
    ? `REMOVE SELF ${input.eventId}`
    : `SELF CHANGE ${input.eventId}`;
  if (input.confirmText?.trim() !== required) {
    throw new Error(`確認のため「${required}」と入力してください。`);
  }
  if (input.losesMemberPermission && !input.confirmText?.trim()) {
    throw new Error(`確認のため「${required}」と入力してください。`);
  }
}

export function assertOwnershipTransferInput(input: {
  eventId: string;
  from: EventStaffOwnershipRow | null;
  to: EventStaffOwnershipRow | null;
  confirmText: string | null | undefined;
  reason: string | null | undefined;
}): void {
  if (!input.reason?.trim()) {
    throw new Error("代表権限の移譲理由を入力してください。");
  }
  const required = `TRANSFER ${input.eventId}`;
  if (input.confirmText?.trim() !== required) {
    throw new Error(`確認のため「${required}」と入力してください。`);
  }
  if (!input.from || !isEventOwner(input.from)) {
    throw new Error("移譲元は現在の代表者である必要があります。");
  }
  if (!input.to || input.to.event_id !== input.eventId) {
    throw new Error("移譲先は同じイベントに登録済みのスタッフを選択してください。");
  }
  if (input.from.id === input.to.id) {
    throw new Error("移譲元と移譲先に同じスタッフは指定できません。");
  }
}
