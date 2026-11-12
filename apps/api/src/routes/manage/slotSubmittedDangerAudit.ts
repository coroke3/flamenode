/**
 * MIG-0656 U03d — strict long audit before/after snapshots for SA-056/057.
 * Pure builder: NO D1/Queue/notification effects and UNMOUNTED.
 * Caller MUST execute returned audits, exact-row CAS mutations, preconditions,
 * Outbox and projection intents in ONE mutateWithAudit D1 batch.
 */
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import type { SubmittedDangerKind, SubmittedDangerSelection } from "./slotSubmittedDangerSelection.ts";
import type { SubmittedDangerAtomicPlan } from "./slotSubmittedDangerMutation.ts";

export function buildSubmittedDangerStrictAudits(input: {
  kind: SubmittedDangerKind;
  selection: SubmittedDangerSelection;
  plan: SubmittedDangerAtomicPlan;
  actorUserId: string;
  updatedAt: number;
}): WriteAuditLogInput[] {
  const { kind, selection, plan, updatedAt } = input;
  if ((kind !== "force-release" && kind !== "keep-reservation") ||
      !selection?.ok || !Array.isArray(selection.rows) ||
      selection.rows.length < 1 || selection.rows.length > MAX_SLOTS_PER_VIDEO ||
      typeof input.actorUserId !== "string" || !input.actorUserId.trim() ||
      input.actorUserId !== input.actorUserId.trim() ||
      !Number.isSafeInteger(updatedAt) || updatedAt < 0 ||
      !plan || plan.affectedSlotIds.length !== selection.rows.length ||
      plan.mutationStatements.length !== plan.expectedMutationChanges.length ||
      plan.expectedMutationChanges[0] !== selection.rows.length ||
      plan.updatesVideoScheduling !== selection.shouldDetachVideoSchedulingAtRead ||
      plan.affectedSlotIds.some((id, i) => id !== selection.rows[i]?.id) ||
      plan.mutationStatements.length !== (plan.updatesVideoScheduling ? 2 : 1) ||
      plan.expectedMutationChanges.some((n, i) => n !== (i === 0 ? selection.rows.length : 1))) {
    throw new Error("slot_submitted_danger_audit_invalid_plan");
  }
  const clearReservation = kind === "force-release";
  const context = clearReservation
    ? "slot-admin:force-release-submitted" : "slot-admin:release-submitted-video";
  const reason = clearReservation
    ? "管理者が提出済み枠を作品を削除せず強制解放"
    : "予約を維持したまま提出作品を解除";

  const audits: WriteAuditLogInput[] = selection.rows.map((before) => ({
    table_name: "slots",
    target_id: before.id,
    operation: "UPDATE",
    before: { ...before },
    after: clearReservation
      ? {
          ...before, status: "available", reserved_by_user_id: null,
          x_user_id: null, reserved_x_id_snapshot: null,
          display_name: null, reservation_group_id: null, video_id: null,
          updated_at: updatedAt, version: before.version + 1,
        }
      : {
          ...before, status: "reserved", video_id: null,
          updated_at: updatedAt, version: before.version + 1,
        },
    actor_user_id: input.actorUserId,
    context,
    reason,
    retention_class: "long_audit",
    strict: true,
  }));

  if (plan.updatesVideoScheduling) {
    const before = selection.videoAuditBefore;
    if (!before || !selection.videoBefore ||
        !selection.videoId || before.id !== selection.videoId ||
        before.id !== selection.videoBefore.id ||
        before.updated_at !== selection.videoBefore.updated_at ||
        before.scheduling_type !== "slotted" ||
        selection.videoBefore.scheduling_type !== "slotted") {
      throw new Error("slot_submitted_danger_missing_complete_video_before");
    }
    audits.push({
      table_name: "videos",
      target_id: before.id,
      operation: "UPDATE",
      before: { ...before },
      after: { ...before, scheduling_type: "manual", updated_at: updatedAt },
      actor_user_id: input.actorUserId,
      context,
      reason: clearReservation
        ? "最後の提出済み枠を解放したため作品をmanual schedulingへ移行"
        : "提出済み参照がなくなったため manual scheduling へ戻す",
      retention_class: "long_audit",
      strict: true,
    });
  }
  return audits;
}
