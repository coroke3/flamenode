import * as React from "react";
import { ConsoleModeBanner } from "@/components/layout/ConsoleModeBanner";

interface ManageModeBannerProps {
  /** イベント詳細など、単一イベントの色を帯に反映する場合 */
  eventAccentColor?: string | null;
}

export function ManageModeBanner({
  eventAccentColor,
}: ManageModeBannerProps): React.ReactElement {
  const style = eventAccentColor
    ? ({ "--manage-event-accent": eventAccentColor } as React.CSSProperties)
    : undefined;

  return (
    <ConsoleModeBanner
      classPrefix="manage-mode"
      badge="MANAGE"
      label="イベント運営"
      style={style}
    >
      担当イベントの審査・枠・通知を確認できます。サイト全体の管理は管理者のみ
      <strong> /admin</strong> で行います。
    </ConsoleModeBanner>
  );
}
