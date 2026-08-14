import { normalizeXId } from "../utils/xid.ts";

/**
 * 承認後に、予約時点で X ID が未確定だった枠を自動 bind できるかを判定する。
 *
 * `approvedXIds` / `pendingXIds` は呼び出し側で alias・merge の現在正本へ
 * 解決してから渡す。同一名義の重複申請だけは曖昧性に数えず、異なる pending
 * identity が残っている場合だけ fail closed にする。
 */
export function canAutoBindUnassignedReservation(input: {
  bindTargetXId: string;
  approvedXIds: readonly string[];
  pendingXIds: readonly string[];
}): boolean {
  const target = normalizeXId(input.bindTargetXId);
  if (!target) return false;

  const approved = new Set(
    input.approvedXIds.map((value) => normalizeXId(value)).filter(Boolean),
  );
  if (approved.size !== 1 || !approved.has(target)) return false;

  const pending = new Set(
    input.pendingXIds.map((value) => normalizeXId(value)).filter(Boolean),
  );
  for (const pendingId of pending) {
    if (pendingId !== target) return false;
  }
  return true;
}
