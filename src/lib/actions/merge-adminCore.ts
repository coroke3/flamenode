import type { WriteAuditLogInput } from "../audit/types.ts";

export type EventStaffSnapshot = {
  id: string;
  event_id: string;
  x_user_id: string;
  display_name: string;
  permission_preset: string;
  custom_permission_keys_json: string | null;
  is_public: number;
  public_role_label: string | null;
  approved_by_auth_user_id: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
};

function sameEventStaffSnapshot(
  before: EventStaffSnapshot,
  after: EventStaffSnapshot,
): boolean {
  return (
    before.id === after.id &&
    before.event_id === after.event_id &&
    before.x_user_id === after.x_user_id &&
    before.display_name === after.display_name &&
    before.permission_preset === after.permission_preset &&
    before.custom_permission_keys_json ===
      after.custom_permission_keys_json &&
    before.is_public === after.is_public &&
    before.public_role_label === after.public_role_label &&
    before.approved_by_auth_user_id === after.approved_by_auth_user_id &&
    before.approved_at === after.approved_at &&
    before.created_at === after.created_at &&
    before.updated_at === after.updated_at
  );
}

export function buildEventStaffMergeAudits(input: {
  beforeRows: readonly EventStaffSnapshot[];
  afterRows: readonly EventStaffSnapshot[];
  actorUserId: string;
  fromXId: string;
  toXId: string;
}): WriteAuditLogInput[] {
  const afterById = new Map(
    input.afterRows.map((row) => [row.id, row] as const),
  );

  return input.beforeRows.flatMap((before): WriteAuditLogInput[] => {
    const after = afterById.get(before.id) ?? null;

    if (!after) {
      return [
        {
          table_name: "event_staff",
          target_id: before.id,
          operation: "DELETE",
          before: { ...before },
          after: null,
          actor_user_id: input.actorUserId,
          reason: `X ID統合によるスタッフ重複解消: @${input.fromXId} → @${input.toXId}`,
          context: "x-id-merge:event-staff",
          retention_class: "restorable",
          restore_strategy: "recreate_deleted",
          strict: true,
        },
      ];
    }

    if (sameEventStaffSnapshot(before, after)) {
      return [];
    }

    return [
      {
        table_name: "event_staff",
        target_id: before.id,
        operation: "UPDATE",
        before: { ...before },
        after: { ...after },
        actor_user_id: input.actorUserId,
        reason: `X ID統合によるスタッフ更新: @${input.fromXId} → @${input.toXId}`,
        context: "x-id-merge:event-staff",
        retention_class: "restorable",
        restore_strategy: "update_before",
        strict: true,
      },
    ];
  });
}
