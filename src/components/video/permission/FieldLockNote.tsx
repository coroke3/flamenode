import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { formatVideoFieldPermissionReason } from "@/lib/video/videoEditPermissionView";
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
  const sourceLabel =
    permission.eventTitle?.trim()
      ? `権限元: ${permission.eventTitle.trim()}`
      : null;

  return (
    <div id={id} role="status" className={styles.note}>
      {reason ? <p className={styles.reason}>{reason}</p> : null}
      {sourceLabel ? <p className={styles.hint}>{sourceLabel}</p> : null}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
