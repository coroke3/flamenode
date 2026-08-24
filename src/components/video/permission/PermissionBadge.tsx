import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import {
  formatPermissionBadge,
  formatPermissionGroupBadge,
} from "@/lib/video/videoEditPermissionView";
import type { PermissionBadge as PermissionBadgeModel } from "@/lib/video/videoEditPermissionView";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import styles from "./PermissionBadge.module.css";

const KIND_CLASS: Record<PermissionBadgeModel["kind"], string> = {
  editable: styles.editable,
  mixed: styles.mixed,
  "owner-denied": styles.ownerDenied,
  event: styles.event,
  admin: styles.admin,
  locked: styles.locked,
};

const KIND_ICON: Record<Exclude<PermissionBadgeModel["kind"], "locked">, IconName> = {
  editable: "check",
  mixed: "info",
  "owner-denied": "info",
  event: "users",
  admin: "alert",
};

export function PermissionLockIcon({ size = 11 }: { size?: number }): React.ReactElement {
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
      className={styles.icon}
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PermissionBadgeVisual({
  badge,
  className,
  privilegedEditable = false,
}: {
  badge: PermissionBadgeModel;
  className?: string;
  privilegedEditable?: boolean;
}): React.ReactElement {
  return (
    <span
      className={cn(
        styles.badge,
        KIND_CLASS[badge.kind],
        privilegedEditable && styles.privilegedEditable,
        className,
      )}
      aria-label={`編集状態: ${badge.text}`}
    >
      {badge.kind === "locked" ? (
        <PermissionLockIcon />
      ) : (
        <Icon
          name={KIND_ICON[badge.kind]}
          size={11}
          className={styles.icon}
          aria-hidden
        />
      )}
      <span>{badge.text}</span>
    </span>
  );
}

export interface PermissionBadgeProps {
  permission: VideoFieldPermission;
  className?: string;
}

export function PermissionBadge({
  permission,
  className,
}: PermissionBadgeProps): React.ReactElement {
  const badge = formatPermissionBadge(permission);
  return (
    <PermissionBadgeVisual
      badge={badge}
      className={className}
      privilegedEditable={
        permission.editable && permission.source !== "owner_general"
      }
    />
  );
}

export interface PermissionGroupBadgeProps {
  permissions: readonly VideoFieldPermission[];
  className?: string;
}

export function PermissionGroupBadge({
  permissions,
  className,
}: PermissionGroupBadgeProps): React.ReactElement {
  const badge = formatPermissionGroupBadge(permissions);
  const privilegedEditable =
    badge.kind === "editable" &&
    permissions.some((permission) => permission.source !== "owner_general");
  return (
    <PermissionBadgeVisual
      badge={badge}
      className={className}
      privilegedEditable={privilegedEditable}
    />
  );
}
