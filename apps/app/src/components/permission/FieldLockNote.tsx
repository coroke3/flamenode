// Port of CURRENT src/components/video/permission/FieldLockNote.tsx (MIG-0712). Same output.
import * as React from "react";
import type { VideoFieldPermission } from "../../lib/videoEditPermissionView.js";
import { formatVideoFieldPermissionReason } from "../../lib/videoEditPermissionView.js";
import { PermissionLockIcon } from "./PermissionBadge.js";

export interface FieldLockNoteProps {
  permission: VideoFieldPermission;
  id?: string;
  unlockHint?: "admin" | "event" | null;
}

function formatUnlockHint(unlockHint: "admin" | "event"): string {
  if (unlockHint === "admin") {
    return "画面上部の「管理者権限で編集」に切り替えると、編集できる場合があります。";
  }
  return "画面上部の「イベント運営権限で編集」に切り替えると、編集できる場合があります。";
}

export function FieldLockNote({
  permission,
  id,
  unlockHint = null,
}: FieldLockNoteProps): React.ReactElement | null {
  if (permission.editable) {
    return null;
  }

  const reason = formatVideoFieldPermissionReason(permission);
  const hint = unlockHint ? formatUnlockHint(unlockHint) : null;

  return (
    <div id={id} className={"perm-lock-note"}>
      <span className={"perm-lock-icon"}>
        <PermissionLockIcon size={14} />
      </span>
      <div className={"perm-lock-copy"}>
        {reason ? <p className={"perm-lock-reason"}>{reason}</p> : null}
        {hint ? <p className={"perm-lock-hint"}>{hint}</p> : null}
      </div>
    </div>
  );
}
