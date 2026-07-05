import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { costUsageSnapshots, auditLogs, systemSettings } from "@/lib/db/schema";
import { CostGuardForm } from "@/components/admin/CostGuardForm";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  parseCostGuardThresholds,
  recommendCostGuardMode,
} from "@/lib/admin/costGuardPolicy";
import { parseAuditDiff } from "@/lib/audit/diff";
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
  let autoEnabled = 1;
  let reason: string | null = null;
  let updatedAt: number | null = null;
  let thresholdsJson: string | null = null;
  let exceptionUntil: number | null = null;
  let exceptionFeaturesJson: string | null = null;
  let latestSnapshot: (typeof costUsageSnapshots.$inferSelect) | null = null;
  let history: (typeof auditLogs.$inferSelect)[] = [];
  if (db) {
    try {
      const rows = await db.select().from(systemSettings).limit(1);
      if (rows[0]) {
        mode = resolveOperationMode(rows[0]);
        isMaintenance = mode === "maintenance" ? 1 : 0;
        autoEnabled = rows[0].auto_cost_guard_enabled ?? 1;
        reason = rows[0].cost_guard_reason;
        updatedAt = rows[0].cost_guard_updated_at ?? null;
        thresholdsJson = rows[0].cost_guard_thresholds_json;
        exceptionUntil = rows[0].cost_guard_exception_until ?? null;
        exceptionFeaturesJson = rows[0].cost_guard_exception_features_json;
      }
      latestSnapshot = (
        await db
          .select()
          .from(costUsageSnapshots)
          .orderBy(desc(costUsageSnapshots.captured_at))
          .limit(1)
      )[0] ?? null;
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
  const recommendation = recommendCostGuardMode(
    latestSnapshot,
    parseCostGuardThresholds(thresholdsJson),
  );

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
            thresholdsJson={thresholdsJson}
            exceptionUntil={exceptionUntil}
            exceptionFeaturesJson={exceptionFeaturesJson}
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
          最新 snapshot
        </h2>
        <div
          style={{
            padding: "16px 18px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {latestSnapshot ? (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="fn-badge fn-badge-soft">
                  source: {latestSnapshot.source ?? "unknown"}
                </span>
                <span className="fn-badge fn-badge-soft">
                  captured: {formatRelative(latestSnapshot.captured_at)}
                </span>
                <span
                  className={`fn-badge ${
                    recommendation.mode === "normal"
                      ? "fn-badge-accent"
                      : recommendation.mode === "economy"
                        ? "fn-badge-warning"
                        : "fn-badge-danger"
                  }`}
                >
                  推奨: {recommendation.mode}
                </span>
              </div>
              <FnTable>
                <tbody>
                  <SnapshotRow label="Workers requests" value={latestSnapshot.workers_requests_today} />
                  <SnapshotRow label="Pages Functions" value={latestSnapshot.pages_functions_requests_today} />
                  <SnapshotRow label="D1 rows read" value={latestSnapshot.d1_rows_read_today} />
                  <SnapshotRow label="D1 rows written" value={latestSnapshot.d1_rows_written_today} />
                  <SnapshotRow label="R2 class A" value={latestSnapshot.r2_class_a_month} />
                  <SnapshotRow label="R2 class B" value={latestSnapshot.r2_class_b_month} />
                  <SnapshotRow label="KV writes" value={latestSnapshot.kv_writes_today} />
                </tbody>
              </FnTable>
              {recommendation.reasons.length > 0 ? (
                <p className="fn-muted fn-text-sm" style={{ marginTop: 10 }}>
                  閾値接近: {recommendation.reasons.join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="fn-muted fn-text-sm">
              まだ cost_usage_snapshots はありません。Cloudflare API 連携前は estimated_local を低頻度に保存してください。
            </p>
          )}
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

function SnapshotRow({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}): React.ReactElement {
  return (
    <tr>
      <th style={{ width: 220 }}>{label}</th>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>
        {Number(value ?? 0).toLocaleString()}
      </td>
    </tr>
  );
}
