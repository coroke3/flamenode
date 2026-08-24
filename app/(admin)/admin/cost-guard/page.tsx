import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { auditLogs } from "@/lib/db/schema";
import { CostGuardForm } from "@/components/admin/CostGuardForm";
import { CostGuardOverrideForm } from "@/components/admin/CostGuardOverrideForm";
import { CostGuardDisabledFeaturesForm } from "@/components/admin/CostGuardDisabledFeaturesForm";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { parseAuditDiff } from "@/lib/audit/diff";
import { readAdminSystemSettings } from "@/lib/admin/adminSystemSettings";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import type { OperationMode } from "@/lib/operationMode/types";

export const metadata: Metadata = { title: "コストガード" };
export const dynamic = "force-dynamic";

const MODES: Array<{
  value: OperationMode;
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
  let mode: OperationMode = "normal";
  let isMaintenance = 0;
  let reason: string | null = null;
  let updatedAt: number | null = null;
  let exceptionUntil: number | null = null;
  let exceptionFeaturesJson: string | null = null;
  let disabledFeaturesJson: string | null = null;
  let history: (typeof auditLogs.$inferSelect)[] = [];
  if (db) {
    try {
      const settings = await readAdminSystemSettings(db);
      if (settings) {
        mode = resolveOperationMode(settings);
        isMaintenance = mode === "maintenance" ? 1 : 0;
        reason = settings.cost_guard_reason;
        updatedAt = settings.cost_guard_updated_at ?? null;
        exceptionUntil = settings.cost_guard_exception_until ?? null;
        exceptionFeaturesJson = settings.cost_guard_exception_features_json;
        disabledFeaturesJson = settings.disabled_features_json;
      }
      history = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.table_name, "system_settings"),
            eq(auditLogs.operation, "UPDATE"),
          )!,
        )
        .orderBy(desc(auditLogs.created_at))
        .limit(20);
    } catch (e) {
      console.error("[AdminCostGuardPage]", e);
      }
  }

  return (
    <div>
      <AdminPageHeader
        title="コストガード"
        description="実測collectorがないため、自動判定は行わず手動モードと15分限定overrideだけを管理します。"
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
          />
          <CostGuardOverrideForm
            exceptionUntil={exceptionUntil}
            exceptionFeaturesJson={exceptionFeaturesJson}
          />
          <CostGuardDisabledFeaturesForm
            disabledFeaturesJson={disabledFeaturesJson}
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
          <FnTable>
            <thead>
              <tr>
                <th>日時</th>
                <th>実行者</th>
                <th>変更キー</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const changed = parseAuditDiff(
                  h.before_json,
                  h.after_json,
                ).changedKeys;
                return (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(h.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {formatRelative(h.created_at)}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {h.actor_user_id ? (
                        <Link
                          href={`/admin/users/${encodeURIComponent(h.actor_user_id)}`}
                        >
                          {h.actor_user_id}
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
                          {h.target_id ? (
                            <Link
                              href={`/admin/audit?table=system_settings&record=${encodeURIComponent(h.target_id)}`}
                              className="fn-btn fn-btn-ghost fn-btn-sm"
                              style={{
                                marginLeft: 6,
                                padding: "0 6px",
                                height: 22,
                                fontSize: 11,
                              }}
                            >
                              詳細
                            </Link>
                          ) : null}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </FnTable>
        )}
      </section>

    </div>
  );
}
