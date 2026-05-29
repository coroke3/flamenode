import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { runHealthChecks, type HealthCheckResult } from "@/lib/admin/healthChecks";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "DB ヘルスチェック" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "warn" | "info" | "ok";

interface Props {
  searchParams?: Promise<{ status?: string }>;
}

export default async function AdminHealthPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const filter: StatusFilter = (() => {
    switch (sp.status) {
      case "warn":
      case "info":
      case "ok":
        return sp.status;
      default:
        return "all";
    }
  })();

  const db = getDatabase();
  let results: HealthCheckResult[] = [];
  let error: string | null = null;

  if (db) {
    try {
      results = await runHealthChecks(db);
    } catch (e) {
      error = String(e);
    }
  } else {
    error = "DB に接続できませんでした。";
  }

  const counts = {
    all: results.length,
    warn: results.filter((r) => r.status === "warn").length,
    info: results.filter((r) => r.status === "info").length,
    ok: results.filter((r) => r.status === "ok").length,
  };

  const visible =
    filter === "all" ? results : results.filter((r) => r.status === filter);

  return (
    <div>
      <AdminPageHeader
        title="DB ヘルスチェック"
        description="データベースの整合性を読み取り専用で点検します。修復操作はありません。"
      />

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
          <strong>DB整合性チェック</strong>
          <p className="fn-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            参照切れ、派生行欠落、スロット状態矛盾をカード形式で確認できます。
          </p>
        </div>
        <Link href="/admin/health/integrity" className="fn-btn fn-btn-primary">
          DB整合性チェックへ
        </Link>
      </section>

      <nav
        aria-label="状態フィルタ"
        style={{
          marginTop: 16,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "すべて"],
            ["warn", "WARN"],
            ["info", "INFO"],
            ["ok", "OK"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/admin/health" : `/admin/health?status=${key}`}
            className={`fn-btn fn-btn-sm ${filter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {label} ({counts[key]})
          </Link>
        ))}
      </nav>

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
        <>
          {counts.warn > 0 ? (
            <div
              role="status"
              style={{
                marginTop: 14,
                padding: "10px 14px",
                background: "var(--accent-warning-soft, #fef3c7)",
                border: "1px solid var(--accent-warning, #d97706)",
                borderRadius: "var(--radius-md)",
                color: "var(--accent-warning, #92400e)",
                fontSize: 13,
              }}
            >
              <strong>WARN {counts.warn} 件</strong>
              {" "}が検出されています。一覧から確認してください。
            </div>
          ) : (
            <div
              role="status"
              style={{
                marginTop: 14,
                padding: "10px 14px",
                background: "var(--accent-success-soft, #dcfce7)",
                border: "1px solid var(--accent-success, #16a34a)",
                borderRadius: "var(--radius-md)",
                color: "var(--accent-success, #166534)",
                fontSize: 13,
              }}
            >
              現在 WARN はありません ({counts.ok} 件 OK, {counts.info} 件 INFO)。
            </div>
          )}
        </>
      )}
      {!error ? (
        <section style={{ marginTop: 22 }}>
          <table className="fn-table">
            <thead>
              <tr>
                <th>チェック項目</th>
                <th>状態</th>
                <th>件数</th>
                <th>サンプル (最大5件)</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                    フィルタ条件に該当する項目はありません。
                  </td>
                </tr>
              ) : null}
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                    {r.note ? (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {r.note}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`fn-badge ${
                        r.status === "ok"
                          ? "fn-badge-accent"
                          : r.status === "info"
                            ? "fn-badge-neutral"
                            : "fn-badge-warning"
                      }`}
                    >
                      {r.status === "ok"
                        ? "OK"
                        : r.status === "info"
                          ? "INFO"
                          : "WARN"}
                    </span>
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.count}</td>
                  <td>
                    {r.samples.length === 0 ? (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11, lineHeight: 1.6 }}>
                        {r.samples.map((s, i) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <li key={i} style={{ fontFamily: "monospace" }}>{s}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
