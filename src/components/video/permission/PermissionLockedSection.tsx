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

function LockIcon({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.lockIcon}
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PermissionLockedSection({
  title,
  permission,
  unlockHint = null,
  children,
}: PermissionLockedSectionProps): React.ReactElement {
  const locked = !permission.editable;

  return (
    <section className={cn(styles.section, locked && styles.permissionSectionLocked)}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <PermissionBadge permission={permission} />
      </header>

      {locked ? (
        <div className={styles.lockBanner}>
          <LockIcon />
          <FieldLockNote permission={permission} unlockHint={unlockHint} />
        </div>
      ) : null}

      <div className={styles.content}>{children}</div>
    </section>
  );
}
