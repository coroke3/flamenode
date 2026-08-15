import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  runHealthChecks,
  runOperationalHealthChecks,
  type HealthCheckResult,
} from "@/lib/admin/healthChecks";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import {
  DiagnosticStatusResults,
  type DiagnosticFilter,
} from "@/components/admin/DiagnosticStatusResults";

export const metadata: Metadata = { title: "DB ヘルスチェック" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "warn" | "info" | "ok";

interface Props {
  searchParams?: Promise<{ status?: string; deep?: string; run?: string }>;
}

export default async function AdminHealthPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const initialFilter: StatusFilter = (() => {
    switch (sp.status) {
      case "warn":
      case "info":
      case "ok":
        return sp.status;
      default:
        return "all";
    }
  })();
  const fullRun = sp.deep === "1" || sp.run === "1";

  const db = getDatabase();
  let results: HealthCheckResult[] = [];
  let error: string | null = null;

  if (db) {
    try {
      results = fullRun
        ? await runHealthChecks(db)
        : await runOperationalHealthChecks(db);
    } catch (e) {
      error = String(e);
    }
  } else {
    error = "DB に接続できませんでした。";
  }

  return (
    <div>
      <AdminPageHeader
        title="DB ヘルスチェック"
        description="データベースの整合性を読み取り専用で点検します。修復操作はありません。"
      />

      <AdminSectionTabs hub="health" />

      <section
        className="fn-card"
        style={{
          marginTop: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>{fullRun ? "全体診断" : "運用チェック"}</strong>
          <p className="fn-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            {fullRun
              ? "参照切れ、派生行欠落、枠状態矛盾を含む全項目を確認しています。"
              : "通知・モデレーション・設定など、通常運用に必要な項目だけを確認します。詳細診断は明示的に実行してください。"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!fullRun ? (
            <Link href="/admin/health?deep=1" className="fn-btn fn-btn-primary">
              全体診断を実行
            </Link>
          ) : (
            <Link href="/admin/health" className="fn-btn fn-btn-ghost">
              通常の運用チェックへ戻る
            </Link>
          )}
          <Link href="/admin/health/integrity" className="fn-btn fn-btn-ghost">
            DB整合性チェックへ
          </Link>
        </div>
      </section>

  {error ? (
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--color-danger, #e53e3e)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-danger, #e53e3e)",
            fontSize: 13,
          }}
        >
          エラー: {error}
        </div>
      ) : (
        <DiagnosticStatusResults
          kind="health"
          results={results}
          initialFilter={initialFilter as DiagnosticFilter}
        />
      )}
    </div>
  );
}
