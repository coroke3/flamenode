import type { Metadata } from "next";
import * as React from "react";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { LegacyCanonicalImportClient } from "@/components/admin/LegacyCanonicalImportClient";

export const metadata: Metadata = { title: "旧形式インポート" };
export const dynamic = "force-dynamic";

export default function LegacyImportPage(): React.ReactElement {
  return (
    <div>
      <AdminPageHeader
        title="旧形式インポート"
        description="旧JSON・CSV・TSVを解析し、旧列や旧状態を残さず現在のDB正本へ変換します。一般ランタイムの後方互換機能ではありません。"
      />
      <section style={{ marginTop: 14, marginBottom: 18, padding: "14px 16px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
        <strong>安全条件</strong>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
          プレビュー後にだけ実行できます。既存データの置換は、過去にこのインポート機能で作成されたイベント・作品だけに限定されます。
          X名義、イベントowner、作品メンバー、チャプター、YouTube情報、使用ソフトは新正本テーブルへ直接保存します。
        </p>
      </section>
      <LegacyCanonicalImportClient />
    </div>
  );
}
