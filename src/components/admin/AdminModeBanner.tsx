import * as React from "react";

export function AdminModeBanner(): React.ReactElement {
  return (
    <div className="admin-mode-banner">
      <span className="admin-mode-badge">ADMIN</span>
      <span className="admin-mode-label">管理本部</span>
      <p className="admin-mode-hint">
        サイト全体の設定・監査・ユーザー管理を行います。担当イベントの現場運用は
        <strong> /manage</strong> から行ってください。
      </p>
    </div>
  );
}
