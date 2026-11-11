import * as React from "react";
import type { ManageStaffMember } from "@flamenode/contracts";

/** CURRENT PRESET_DEFINITIONS labels; no server-only permission resolver is bundled into Ops. */
const PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  owner: "代表",
  manager: "運営",
  reviewer: "レビュー担当",
  slot_manager: "枠管理担当",
  content_editor: "作品修正担当",
  xid_reviewer: "X ID確認担当",
  public_staff: "表示のみスタッフ",
  custom: "カスタム",
});
export function presetLabel(preset: string | null): string {
  return preset != null && Object.prototype.hasOwnProperty.call(PRESET_LABELS, preset)
    ? PRESET_LABELS[preset]! : "未設定";
}

function safeIconUrl(value: string | null): string | null {
  if (!value) return null;
  // Signed internal icons are resolved by Hono. Do not accept arbitrary schemes.
  if (value.startsWith("/api/media/xicons/")) return value;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Port of CURRENT src/components/admin/EventStaffReadOnlyList.tsx (MIG-0723 U01a). */
export function EventStaffReadOnlyList({ members }: { members: readonly ManageStaffMember[] }): React.ReactElement {
  if (members.length === 0) {
    return <p className="fn-console-note" style={{ margin: 0 }}>運営メンバーはまだ登録されていません。</p>;
  }
  return <ul className="manage-staff-list">
    {members.map(member => {
      const displayName = member.x_name ?? member.display_name;
      const icon = safeIconUrl(member.icon_url);
      return <li key={member.id} className="manage-staff-list-item">
        <div className="manage-staff-list-row manage-staff-list-row--static">
          {icon ? <img src={icon} width={36} height={36} alt="" loading="lazy" referrerPolicy="no-referrer" /> : (
            <span aria-hidden="true" className="manage-x-icon-fallback">{displayName.slice(0, 1)}</span>
          )}
          <span className="manage-staff-list-main">
            <strong>{displayName}</strong>
            <span className="manage-staff-list-xid">@{member.x_user_id}</span>
          </span>
          <span className="manage-staff-list-badges">
            {member.permission_preset === "owner" && <span className="fn-badge fn-badge-warning">代表者</span>}
            <span className="fn-badge fn-badge-soft">{presetLabel(member.permission_preset)}</span>
            <span className="fn-badge fn-badge-neutral">{member.is_public === 1 ? "公開" : "非公開"}</span>
            {member.public_role_label && <span className="fn-badge fn-badge-soft">{member.public_role_label}</span>}
          </span>
        </div>
      </li>;
    })}
  </ul>;
}
