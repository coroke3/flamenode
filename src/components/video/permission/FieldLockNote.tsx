import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { formatVideoFieldPermissionReason } from "@/lib/video/videoEditPermissionView";
import { PermissionLockIcon } from "./PermissionBadge";
import styles from "./FieldLockNote.module.css";

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
    <div id={id} className={styles.note}>
      <span className={styles.icon}>
        <PermissionLockIcon size={14} />
      </span>
      <div className={styles.copy}>
        {reason ? <p className={styles.reason}>{reason}</p> : null}
        {hint ? <p className={styles.hint}>{hint}</p> : null}
      </div>
    </div>
  );
}
