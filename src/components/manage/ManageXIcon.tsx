"use client";

import * as React from "react";
import { UserAvatar } from "@/components/user/UserAvatar";

export interface ManageXIconProps {
  /** 署名済み Manage URL、または外部 HTTPS URL。null は文字 fallback。 */
  iconUrl: string | null | undefined;
  /** fallback に表示する X 名義。 */
  label: string;
  size?: number;
  className?: string;
  fallbackClassName?: string;
  style?: React.CSSProperties;
}

/**
 * Manage の装飾アイコン。
 * 画像取得に失敗しても再試行・別D1/R2探索を行わず、同じ行の文字fallbackへ切り替える。
 */
export function ManageXIcon({
  iconUrl,
  label,
  size = 36,
  className = "manage-staff-avatar",
  fallbackClassName = "manage-staff-avatar-fallback",
  style,
}: ManageXIconProps): React.ReactElement {
  return (
    <UserAvatar
      iconUrl={iconUrl}
      label={label}
      size={size}
      className={className}
      fallbackClassName={fallbackClassName}
      style={style}
    />
  );
}

// Phase callers may use the shorter semantic name without changing behavior.
export const ManageIcon = ManageXIcon;
