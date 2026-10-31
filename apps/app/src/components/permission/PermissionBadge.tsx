// Port of CURRENT src/components/video/permission/PermissionBadge.tsx (MIG-0712). Same output.
import * as React from "react";
import type { VideoFieldPermission } from "../../lib/videoEditPermissionView.js";
import {
  formatPermissionBadge,
  formatPermissionGroupBadge,
} from "../../lib/videoEditPermissionView.js";
import type { PermissionBadge as PermissionBadgeModel } from "../../lib/videoEditPermissionView.js";
import { Icon, type IconName } from "../../routes/ui/Icon.js";
import { cn } from "../../lib/cn.js";

const KIND_CLASS: Record<PermissionBadgeModel["kind"], string> = {
  editable: "perm-badge-editable",
  mixed: "perm-badge-mixed",
  "owner-denied": "perm-badge-ownerDenied",
  event: "perm-badge-event",
  admin: "perm-badge-admin",
  locked: "perm-badge-locked",
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
      className={"perm-badge-icon"}
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
        "perm-badge-badge",
        KIND_CLASS[badge.kind],
        privilegedEditable && "perm-badge-privilegedEditable",
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
          className={"perm-badge-icon"}
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
