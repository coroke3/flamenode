import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { cn } from "@/lib/utils/cn";
import { PermissionBadge } from "./PermissionBadge";
import { FieldLockNote } from "./FieldLockNote";
import styles from "./PermissionLockedSection.module.css";

export interface PermissionLockedSectionProps {
  title: string;
  permission: VideoFieldPermission;
  unlockHint?: "admin" | "event" | null;
  children: React.ReactNode;
}

export function PermissionLockedSection({
  title,
  permission,
  unlockHint = null,
  children,
}: PermissionLockedSectionProps): React.ReactElement {
  const locked = !permission.editable;
  const reactId = React.useId();
  const titleId = `${reactId}-title`;
  const noteId = `${reactId}-note`;

  return (
    <section
      className={cn(styles.section, locked && styles.permissionSectionLocked)}
      aria-labelledby={titleId}
      aria-describedby={locked ? noteId : undefined}
      tabIndex={locked ? 0 : undefined}
      data-permission-state={locked ? "locked" : "editable"}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <PermissionBadge permission={permission} />
      </header>

      {locked ? (
        <FieldLockNote
          id={noteId}
          permission={permission}
          unlockHint={unlockHint}
        />
      ) : null}

      <div className={styles.content}>{children}</div>
    </section>
  );
}
