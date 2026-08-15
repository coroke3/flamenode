import * as React from "react";
import type { EventStaffMemberRow } from "@/components/admin/EventStaffManager";
import { ManageXIcon } from "@/components/manage/ManageXIcon";
import { PRESET_DEFINITIONS } from "@/lib/auth/permissions/presets";

interface EventStaffReadOnlyListProps {
  members: EventStaffMemberRow[];
}

export function EventStaffReadOnlyList({
  members,
}: EventStaffReadOnlyListProps): React.ReactElement {
  if (members.length === 0) {
    return (
      <p className="fn-console-note" style={{ margin: 0 }}>
        運営メンバーはまだ登録されていません。
      </p>
    );
  }

  return (
    <ul className="manage-staff-list">
      {members.map((member) => {
        const preset = member.permission_preset;
        const presetLabel =
          preset && preset in PRESET_DEFINITIONS
            ? PRESET_DEFINITIONS[preset as keyof typeof PRESET_DEFINITIONS].label
            : "未設定";
        const displayName = member.x_name ?? member.display_name;

        return (
          <li key={member.id} className="manage-staff-list-item">
            <div className="manage-staff-list-row manage-staff-list-row--static">
              <ManageXIcon
                iconUrl={member.icon_url}
                label={displayName}
                size={36}
              />
              <span className="manage-staff-list-main">
                <strong>{displayName}</strong>
                <span className="manage-staff-list-xid">@{member.x_user_id}</span>
              </span>
              <span className="manage-staff-list-badges">
                {preset === "owner" ? (
                  <span className="fn-badge fn-badge-warning">代表者</span>
                ) : null}
                <span className="fn-badge fn-badge-soft">{presetLabel}</span>
                <span className="fn-badge fn-badge-neutral">
                  {member.is_public === 1 ? "公開" : "非公開"}
                </span>
                {member.public_role_label ? (
                  <span className="fn-badge fn-badge-soft">
                    {member.public_role_label}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
