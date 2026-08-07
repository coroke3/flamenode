import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { formatPermissionBadge } from "@/lib/video/videoEditPermissionView";
import type { PermissionBadge as PermissionBadgeModel } from "@/lib/video/videoEditPermissionView";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import styles from "./PermissionBadge.module.css";

const KIND_CLASS: Record<PermissionBadgeModel["kind"], string> = {
  editable: styles.editable,
  "owner-denied": styles.ownerDenied,
  event: styles.event,
  admin: styles.admin,
  locked: styles.locked,
};

const KIND_ICON: Record<PermissionBadgeModel["kind"], IconName> = {
  editable: "check",
  "owner-denied": "info",
  event: "users",
  admin: "alert",
  locked: "warning",
};

export interface PermissionBadgeProps {
  permission: VideoFieldPermission;
  className?: string;
}

export function PermissionBadge({
  permission,
  className,
}: PermissionBadgeProps): React.ReactElement {
  const badge = formatPermissionBadge(permission);
  const ariaLabel = `${badge.text}（${permission.label}）`;

  return (
    <span
      className={cn(styles.badge, KIND_CLASS[badge.kind], className)}
      aria-label={ariaLabel}
    >
      <Icon
        name={KIND_ICON[badge.kind]}
        size={11}
        className={styles.icon}
        aria-hidden
      />
      <span>{badge.text}</span>
    </span>
  );
}
