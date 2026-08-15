import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { runSecurityChecks, type SecurityCheckResult } from "@/lib/admin/securityChecks";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import {
  DiagnosticStatusResults,
  type DiagnosticFilter,
} from "@/components/admin/DiagnosticStatusResults";

export const metadata: Metadata = { title: "セキュリティチェック" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "warn" | "info" | "ok";

interface Props {
  searchParams?: Promise<{ status?: string; run?: string }>;
}

export default async function AdminSecurityPage({
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
  const shouldRun = sp.run === "1";

  const db = getDatabase();
  let results: SecurityCheckResult[] = [];
  let error: string | null = null;

  if (shouldRun) {
    if (!db) {
      error = "DB に接続できませんでした。";
    } else {
      try {
        results = await runSecurityChecks(db);
      } catch (e) {
        error = String(e);
      }
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="セキュリティチェック"
        description="権限・認証状態の整合性を読み取り専用で点検します。初期表示では実行せず、必要なときだけ明示的に実行します。"
      />

      {!shouldRun ? (
        <section className="fn-card" style={{ marginTop: 18 }}>
          <strong>セキュリティ診断は未実行です</strong>
          <p className="fn-muted" style={{ margin: "6px 0 12px", fontSize: 12, lineHeight: 1.6 }}>
            認証・権限関連の全件検査はD1読み取りが多いため、必要なときだけ実行してください。
          </p>
          <Link href="/admin/security?run=1" className="fn-btn fn-btn-primary">
            セキュリティ診断を実行
          </Link>
        </section>
      ) : null}

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
      ) : null}
      {!error && shouldRun ? (
        <DiagnosticStatusResults
          kind="security"
          results={results}
          initialFilter={initialFilter as DiagnosticFilter}
        />
      ) : null}
    </div>
  );
}
