import * as React from "react";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";

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

export default async function AdminCostGuardPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let mode = "normal";
  let isMaintenance = 0;
  let updatedAt: number | null = null;
  if (db) {
    try {
      const rows = await db.select().from(systemSettings).limit(1);
      if (rows[0]) {
        mode = rows[0].cost_guard_mode ?? "normal";
        isMaintenance = rows[0].is_maintenance_mode ?? 0;
        updatedAt = rows[0].cost_guard_updated_at ?? null;
      }
    } catch (e) {
      console.error("[AdminCostGuardPage]", e);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>コストガード</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        Cloudflare 無料枠の使用状況に応じて、機能の段階停止モードを切り替えます。
      </p>

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
          モード選択
        </h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr" }}>
          {MODES.map((m) => (
            <form
              key={m.value}
              method="post"
              action="/api/admin/cost-guard"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "16px 18px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <span className={`fn-badge ${m.badge}`}>{m.label}</span>
              <div>
                <strong style={{ fontSize: 14 }}>{m.value}</strong>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {m.description}
                </div>
              </div>
              <input type="hidden" name="mode" value={m.value} />
              <button
                type="submit"
                disabled={mode === m.value}
                className={`fn-btn fn-btn-${m.value === "maintenance" ? "danger" : "primary"} fn-btn-sm`}
              >
                {mode === m.value ? "適用中" : "切替"}
              </button>
            </form>
          ))}
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
