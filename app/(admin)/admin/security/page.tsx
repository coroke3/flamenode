import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { runSecurityChecks, type SecurityCheckResult } from "@/lib/admin/securityChecks";

export const metadata: Metadata = { title: "セキュリティチェック" };
export const dynamic = "force-dynamic";

type StatusFilter = "all" | "warn" | "info" | "ok";

interface Props {
  searchParams?: Promise<{ status?: string }>;
}

export default async function AdminSecurityPage({
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
  let results: SecurityCheckResult[] = [];
  let error: string | null = null;

  if (db) {
    try {
      results = await runSecurityChecks(db);
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
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>セキュリティチェック</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        権限・認証状態の整合性を読み取り専用で点検します。修復操作はありません。
      </p>

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
            href={key === "all" ? "/admin/security" : `/admin/security?status=${key}`}
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
        <section style={{ marginTop: 22 }}>
          <table className="fn-table">
            <thead>
              <tr>
                <th>チェック項目</th>
                <th>状態</th>
                <th>件数</th>
                <th>サンプル / 備考</th>
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
                  </td>
                  <td>
                    {r.status === "ok" ? (
                      <span className="fn-badge fn-badge-accent">OK</span>
                    ) : r.status === "info" ? (
                      <span className="fn-badge fn-badge-soft">INFO</span>
                    ) : (
                      <span className="fn-badge fn-badge-warning">WARN</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.status === "info" ? "—" : r.count}
                  </td>
                  <td>
                    {r.note ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.note}</span>
                    ) : r.samples.length === 0 ? (
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
