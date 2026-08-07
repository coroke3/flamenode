import * as React from "react";
import type { VideoFieldPermission } from "@/lib/video/videoEditPermissionView";
import { cn } from "@/lib/utils/cn";
import { PermissionBadge } from "./PermissionBadge";
import styles from "./PermissionFieldLabel.module.css";

export interface PermissionFieldLabelProps {
  label: string;
  htmlFor?: string;
  permission: VideoFieldPermission;
  required?: boolean;
  noteId?: string;
}

export function PermissionFieldLabel({
  label,
  htmlFor,
  permission,
  required = false,
  noteId,
}: PermissionFieldLabelProps): React.ReactElement {
  const describedBy = !permission.editable && noteId ? noteId : undefined;

  return (
    <div className={styles.labelRow}>
      <label
        htmlFor={htmlFor}
        className={cn(styles.label, required && styles.required)}
        aria-describedby={describedBy}
      >
        {label}
      </label>
      <PermissionBadge permission={permission} className={styles.badge} />
    </div>
  );
}
