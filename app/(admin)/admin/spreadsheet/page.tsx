import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isAdminSpreadsheetEnabled } from "@/lib/admin/spreadsheet/guard";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSpreadsheetClient } from "@/components/admin/spreadsheet/AdminSpreadsheetClient";

export const metadata: Metadata = { title: "DB スプレッドシート" };
export const dynamic = "force-dynamic";

export default async function AdminSpreadsheetPage({
  searchParams,
}: {
  searchParams?: Promise<{ table?: string }>;
}): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  if (!isAdminSpreadsheetEnabled()) {
    return (
      <div style={{ paddingBottom: 48 }}>
        <AdminPageHeader
          title="DB スプレッドシート"
          description="この機能は環境変数で有効化する必要があります。"
          backHref="/admin"
          backLabel="ダッシュボード"
        />
        <div
          className="fn-card"
          style={{ padding: 20, maxWidth: 560, lineHeight: 1.65 }}
        >
          <p style={{ margin: "0 0 12px" }}>
            <code>ADMIN_SPREADSHEET_ENABLED=true</code>{" "}
            が未設定のため、スプレッドシートは無効です。
          </p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              リポジトリ直下の <code>.dev.vars</code> に{" "}
              <code>ADMIN_SPREADSHEET_ENABLED=&quot;true&quot;</code> を追加
            </li>
            <li>
              <code>npm run dev</code> を再起動（ポートはターミナル表示を確認）
            </li>
          </ol>
        </div>
      </div>
    );
  }

  const sp = (await searchParams) ?? {};
  const initialTable = (sp.table ?? "").trim() || undefined;

  return (
    <div style={{ paddingBottom: 48 }}>
      <AdminPageHeader
        title="DB スプレッドシート"
        description="D1 の全テーブルを表形式で閲覧・編集します。変更は audit_logs に記録されます。認証トークン列はマスク表示・編集不可です。"
        backHref="/admin"
        backLabel="ダッシュボード"
      />

      <p
        className="fn-muted fn-text-sm"
        style={{ margin: "0 0 16px", maxWidth: 720, lineHeight: 1.65 }}
      >
        本機能は <code>ADMIN_SPREADSHEET_ENABLED=true</code>{" "}
        のときのみ有効です。1ページの行数は{" "}
        <code>ADMIN_SPREADSHEET_PAGE_SIZE</code>（未設定時 500）で変更できます。
        外部キー制約やアプリ側バリデーションは通らないため、緊急対応・データ確認向けに使ってください。
      </p>

      <AdminSpreadsheetClient initialTable={initialTable} />
    </div>
  );
}
