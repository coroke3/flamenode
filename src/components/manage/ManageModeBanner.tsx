import * as React from "react";

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
    <div className="manage-mode-banner" style={style}>
      <span className="manage-mode-badge">MANAGE</span>
      <span className="manage-mode-label">イベント運営</span>
      <p className="manage-mode-hint">
        担当イベントの審査・スロット・通知を確認できます。サイト全体の管理は管理者のみ
        <strong> /admin</strong> で行います。
      </p>
    </div>
  );
}
