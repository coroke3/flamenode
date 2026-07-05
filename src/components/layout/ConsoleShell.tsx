import * as React from "react";

/**
 * /admin・/manage 共通の 2 カラムシェル (左ナビ固定幅 + メイン)。
 */
export function ConsoleShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="admin-shell">
      <div className="admin-frame">{children}</div>
    </div>
  );
}
