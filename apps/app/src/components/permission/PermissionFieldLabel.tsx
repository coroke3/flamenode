// Port of CURRENT src/components/video/permission/PermissionFieldLabel.tsx (MIG-0712). Same output.
import * as React from "react";
import type { VideoFieldPermission } from "../../lib/videoEditPermissionView.js";
import { cn } from "../../lib/cn.js";
import { PermissionBadge } from "./PermissionBadge.js";

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
  const labelClassName = cn("perm-label-label", required && "perm-label-required");

  return (
    <div className={"perm-label-labelRow"}>
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
        <PermissionBadge permission={permission} className={"perm-label-badge"} />
      ) : null}
    </div>
  );
}
