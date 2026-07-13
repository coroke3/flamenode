import * as React from "react";
import { ConsoleDrawer } from "./ConsoleDrawer";

/**
 * /admin・/manage 共通の 2 カラムシェル (左ナビ固定幅 + メイン)。
 */
export function ConsoleShell({
  consoleMode,
  navigation,
  children,
}: {
  consoleMode: "admin" | "manage";
  navigation: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const isAdmin = consoleMode === "admin";
  const label = isAdmin ? "管理メニュー" : "運営メニュー";

  return (
    <div className={isAdmin ? "admin-shell" : "manage-shell"} data-console-mode={consoleMode}>
      <div className={isAdmin ? "admin-frame" : "fn-console-frame"}>
        <ConsoleDrawer
          label={label}
          modeLabel={
            isAdmin ? "サイト管理" : "イベント運営"
          }
        >
          {navigation}
        </ConsoleDrawer>
        {children}
      </div>
    </div>
  );
}
