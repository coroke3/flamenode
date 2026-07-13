import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  runIntegrityChecks,
  type IntegrityCheckResult,
  type IntegritySeverity,
} from "@/lib/admin/integrityChecks";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "DB 整合性チェック" };
export const dynamic = "force-dynamic";

function severityLabel(severity: IntegritySeverity): string {
  switch (severity) {
    case "danger":
      return "危険";
    case "warning":
      return "警告";
    case "info":
      return "確認";
  }
}

function severityBadgeClass(severity: IntegritySeverity): string {
  switch (severity) {
    case "danger":
      return "fn-badge-danger";
    case "warning":
      return "fn-badge-warning";
    case "info":
      return "fn-badge-soft";
  }
}

function CheckCard({ result }: { result: IntegrityCheckResult }): React.ReactElement {
  const hasIssue = result.count > 0;
  return (
    <article
      className="fn-card"
      style={{
        display: "grid",
        gap: 12,
        borderColor: hasIssue
          ? result.severity === "danger"
            ? "var(--accent-danger)"
            : result.severity === "warning"
              ? "var(--accent-warning)"
              : "var(--border-subtle)"
          : "var(--border-subtle)",
      }}
    >
      <header style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <span className={`fn-badge ${severityBadgeClass(result.severity)}`}>
              {severityLabel(result.severity)}
            </span>
            <span className="fn-badge fn-badge-soft">{result.area}</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 15 }}>{result.title}</h2>
          <p className="fn-muted" style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.65 }}>
            {result.description}
          </p>
        </div>
        <div
          style={{
            minWidth: 74,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <strong style={{ fontSize: 22 }}>{result.count}</strong>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>件</div>
        </div>
      </header>

      {hasIssue ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 10,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-elevated)",
          }}
        >
          {result.issues.map((issue) => (
            <div
              key={`${result.id}-${issue.id}`}
              style={{
                display: "grid",
                gap: 4,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>{issue.title || issue.id}</strong>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  {issue.id}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                {issue.description}
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {issue.adminHref ? (
                  <Link href={issue.adminHref} className="fn-btn fn-btn-ghost fn-btn-sm">
                    <Icon name="external" size={11} aria-hidden />
                    管理画面
                  </Link>
                ) : null}
                {issue.publicHref ? (
                  <Link href={issue.publicHref} className="fn-btn fn-btn-ghost fn-btn-sm">
                    <Icon name="external" size={11} aria-hidden />
                    公開ページ
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
          {result.moreCount > 0 ? (
            <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
              他 {result.moreCount} 件あります。表示は各チェック最大50件です。
            </p>
          ) : null}
        </div>
      ) : (
        <p
          role="status"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-success-soft, #dcfce7)",
            color: "var(--accent-success, #166534)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          問題なし
        </p>
      )}

      <section
        style={{
          display: "grid",
          gap: 6,
          fontSize: 12,
          lineHeight: 1.65,
          color: "var(--text-secondary)",
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>推奨対応</strong>
        <p style={{ margin: 0 }}>{result.recommendation}</p>
        {result.sqlPreview ? (
          <details>
            <summary style={{ cursor: "pointer", color: "var(--text-primary)" }}>
              修復SQLプレビュー（この画面では実行されません）
            </summary>
            <p style={{ margin: "4px 0", fontSize: 11, color: "var(--text-muted)" }}>
              この画面は読み取り専用です。修復SQLは確認用プレビューであり、この画面からは実行されません。
              修復機能は未実装です。実行する場合は、内容を確認したうえで管理者が別途D1に適用してください。
            </p>
            <pre
              style={{
                marginTop: 6,
                padding: 10,
                overflow: "auto",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-surface)",
                fontSize: 11,
                whiteSpace: "pre-wrap",
              }}
            >
              {result.sqlPreview}
            </pre>
          </details>
        ) : null}
      </section>
    </article>
  );
}

export default async function AdminIntegrityPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const db = getDatabase();
  let results: IntegrityCheckResult[] = [];
  let error: string | null = null;
  if (!db) {
    error = "DB に接続できませんでした。";
  } else {
    try {
      results = await runIntegrityChecks(db);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const issueCount = results.reduce((sum, r) => sum + r.count, 0);
  const dangerCount = results.filter((r) => r.count > 0 && r.severity === "danger").length;
  const warningCount = results.filter((r) => r.count > 0 && r.severity === "warning").length;
  const infoCount = results.filter((r) => r.count > 0 && r.severity === "info").length;

  return (
    <div>
      <AdminPageHeader
        title="DB 整合性チェック"
        description="videos / video_events / video_members / slots / 派生行 / audit_logs の参照整合性を読み取り専用で確認します。"
        backHref="/admin/health"
        backLabel="ヘルスチェックへ"
      />

      <AdminSectionTabs hub="health" />

      <section
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
        }}
      >
        <Metric label="総検出件数" value={issueCount} />
        <Metric label="危険チェック" value={dangerCount} tone="danger" />
        <Metric label="警告チェック" value={warningCount} tone="warning" />
        <Metric label="確認チェック" value={infoCount} />
      </section>

      {error ? (
        <div className="fn-card" style={{ marginTop: 18, borderColor: "var(--accent-danger)" }}>
          <strong style={{ color: "var(--accent-danger)" }}>エラー</strong>
          <p style={{ marginBottom: 0 }}>{error}</p>
        </div>
      ) : (
        <section
          style={{
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))",
            gap: 14,
          }}
        >
          {results.map((result) => (
            <CheckCard key={result.id} result={result} />
          ))}
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning";
}): React.ReactElement {
  const color =
    tone === "danger"
      ? "var(--accent-danger)"
      : tone === "warning"
        ? "var(--accent-warning)"
        : "var(--text-primary)";
  return (
    <div className="fn-card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 4, fontSize: 24, color }}>
        {value}
      </strong>
    </div>
  );
}
