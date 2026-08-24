import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { cn } from "@/lib/utils/cn";
import { PermissionBadge } from "./PermissionBadge";
import styles from "./PermissionFieldLabel.module.css";

export interface PermissionFieldLabelProps {
  label: string;
  id?: string;
  htmlFor?: string;
  permission: VideoFieldPermission;
  required?: boolean;
  showEditableBadge?: boolean;
}

export function PermissionFieldLabel({
  label,
  id,
  htmlFor,
  permission,
  required = false,
  showEditableBadge = false,
}: PermissionFieldLabelProps): React.ReactElement {
  const showBadge =
    showEditableBadge ||
    !permission.editable ||
    permission.source !== "owner_general";
  const labelClassName = cn(styles.label, required && styles.required);

  return (
    <div className={styles.labelRow}>
      {htmlFor ? (
        <label id={id} htmlFor={htmlFor} className={labelClassName}>
          {label}
        </label>
      ) : (
        <span id={id} className={labelClassName}>
          {label}
        </span>
      )}
      {showBadge ? (
        <PermissionBadge permission={permission} className={styles.badge} />
      ) : null}
    </div>
  );
}
