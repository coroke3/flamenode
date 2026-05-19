import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, systemSettings } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { CostGuardForm } from "@/components/admin/CostGuardForm";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "コストガード" };
export const dynamic = "force-dynamic";

const MODES: Array<{
  value: string;
  label: string;
  description: string;
  badge: string;
}> = [
  {
    value: "normal",
    label: "通常",
    description: "全機能をフル稼働。",
    badge: "fn-badge-accent",
  },
  {
    value: "economy",
    label: "省エネ",
    description: "重い検索や推薦の更新間隔を緩める。",
    badge: "fn-badge-warning",
  },
  {
    value: "read_only",
    label: "読み取り専用",
    description: "投稿・更新・通知系を停止し、閲覧のみを許可する。",
    badge: "fn-badge-warning",
  },
  {
    value: "static_only",
    label: "静的のみ",
    description: "静的 JSON ベースの閲覧のみ提供する。",
    badge: "fn-badge-danger",
  },
  {
    value: "maintenance",
    label: "メンテナンス",
    description: "全機能停止、メンテナンス画面に誘導する。",
    badge: "fn-badge-danger",
  },
];

type CostGuardMode =
  | "normal"
  | "economy"
  | "read_only"
  | "static_only"
  | "maintenance";

export default async function AdminCostGuardPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let mode: CostGuardMode = "normal";
  let isMaintenance = 0;
  let autoEnabled = 1;
  let reason: string | null = null;
  let updatedAt: number | null = null;
  let history: (typeof historyLogs.$inferSelect)[] = [];
  if (db) {
    try {
      const rows = await db.select().from(systemSettings).limit(1);
      if (rows[0]) {
        mode = (rows[0].cost_guard_mode ?? "normal") as CostGuardMode;
        isMaintenance = rows[0].is_maintenance_mode ?? 0;
        autoEnabled = rows[0].auto_cost_guard_enabled ?? 1;
        reason = rows[0].cost_guard_reason;
        updatedAt = rows[0].cost_guard_updated_at ?? null;
      }
      history = await db
        .select()
        .from(historyLogs)
        .where(
          and(
            eq(historyLogs.table_name, "system_settings"),
            eq(historyLogs.action, "UPDATE"),
          )!,
        )
        .orderBy(desc(historyLogs.created_at))
        .limit(20);
    } catch (e) {
      console.error("[AdminCostGuardPage]", e);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="コストガード"
        description="Cloudflare 無料枠の使用状況に応じて、機能の段階停止モードを切り替えます。"
      />

      <section
        style={{
          marginTop: 22,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          className={`fn-badge ${MODES.find((m) => m.value === mode)?.badge ?? "fn-badge-soft"}`}
        >
          mode: {mode}
        </span>
        <span
          className={`fn-badge ${isMaintenance ? "fn-badge-danger" : "fn-badge-soft"}`}
        >
          メンテナンス: {isMaintenance ? "ON" : "OFF"}
        </span>
        {updatedAt ? (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            最終更新: {new Date(updatedAt * 1000).toLocaleString("ja-JP")}
          </span>
        ) : null}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          設定
        </h2>
        <div
          style={{
            padding: "16px 18px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <CostGuardForm
            mode={mode}
            reason={reason}
            isMaintenance={isMaintenance}
            autoEnabled={autoEnabled}
          />
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
          モードの説明:
          <ul style={{ marginTop: 6, paddingLeft: 16 }}>
            {MODES.map((m) => (
              <li key={m.value} style={{ marginBottom: 4 }}>
                <strong>{m.label}</strong> ({m.value}) — {m.description}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          変更履歴 (直近 20 件)
        </h2>
        {history.length === 0 ? (
          <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
            まだ system_settings の変更履歴はありません。
          </p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>実行者</th>
                <th>変更キー</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const beforeKeys = parseKeys(h.before_data);
                const afterKeys = parseKeys(h.after_data);
                const changed = Array.from(
                  new Set([...beforeKeys, ...afterKeys]),
                ).filter((k) => {
                  try {
                    const b = h.before_data ? JSON.parse(h.before_data) : {};
                    const a = h.after_data ? JSON.parse(h.after_data) : {};
                    return JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null);
                  } catch {
                    return true;
                  }
                });
                return (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(h.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {formatRelative(h.created_at)}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {h.operator_discord_id ? (
                        <Link
                          href={`/admin/users/${encodeURIComponent(h.operator_discord_id)}`}
                        >
                          {h.operator_discord_id}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)", wordBreak: "break-all" }}>
                      {changed.length === 0 ? (
                        <span style={{ color: "var(--text-muted)" }}>変更なし</span>
                      ) : (
                        <>
                          {changed.slice(0, 6).join(", ")}
                          {changed.length > 6 ? ` ほか ${changed.length - 6} 件` : ""}
                          <Link
                            href={`/admin/audit?table=system_settings&record=${encodeURIComponent(h.record_id)}`}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                            style={{ marginLeft: 6, padding: "0 6px", height: 22, fontSize: 11 }}
                          >
                            詳細
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          一時許可
        </h2>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            background: "var(--bg-surface)",
            padding: 16,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <Icon name="info" size={12} aria-hidden /> 読み取り専用中でも、特定の管理者が30分間
          だけ書き込み可能になる「一時許可」を発行できます。理由を必ず入力してください。
          (フォームは <code>/api/admin/cost-guard/temp</code> に POST します)
        </p>
      </section>
    </div>
  );
}

function parseKeys(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    // ignore
  }
  return [];
}
