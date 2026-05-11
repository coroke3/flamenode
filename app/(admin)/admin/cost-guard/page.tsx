import * as React from "react";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { CostGuardForm } from "@/components/admin/CostGuardForm";

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
