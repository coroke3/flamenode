import * as React from "react";
import { ConsoleModeBanner } from "@/components/layout/ConsoleModeBanner";

export function AdminModeBanner(): React.ReactElement {
  return (
    <ConsoleModeBanner classPrefix="admin-mode" badge="ADMIN" label="管理本部">
      サイト全体の設定・監査・ユーザー管理を行います。担当イベントの現場運用は
      <strong> /manage</strong> から行ってください。
    </ConsoleModeBanner>
  );
}
