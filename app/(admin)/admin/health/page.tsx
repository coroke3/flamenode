import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { runHealthChecks, type HealthCheckResult } from "@/lib/admin/healthChecks";

export const metadata: Metadata = { title: "DB ヘルスチェック" };
export const dynamic = "force-dynamic";

export default async function AdminHealthPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

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

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>DB ヘルスチェック</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        データベースの整合性を読み取り専用で点検します。修復操作はありません。
      </p>

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
              {results.map((r) => (
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
      )}
    </div>
  );
}
