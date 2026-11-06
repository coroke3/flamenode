// MIG-0734 U01: port of CURRENT app/(admin)/admin/cost-guard/page.tsx (SA-016..020 callers). Same order, copy, links and classes.
import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import { adminReadRedirect } from "../../api/adminTop.js";
import { createAdminCostGuardApi, type AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { useApiResult } from "../useApiResult.js";
import { formatRelative, formatUnix } from "./adminFormat.js";
import { CostGuardDisabledFeaturesForm } from "./CostGuardDisabledFeaturesForm.js";
import { CostGuardForm } from "./CostGuardForm.js";
import { CostGuardOverrideForm } from "./CostGuardOverrideForm.js";

/** CURRENT parseAuditDiff().changedKeys: sorted union of keys whose JSON value differs; unparsable -> none. */
export function changedCostGuardKeys(before: string | null, after: string | null): string[] {
  const parse = (raw: string | null): Record<string, unknown> | null => {
    if (!raw) return {};
    try {
      const value: unknown = JSON.parse(raw);
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
    } catch { return null; }
  };
  const a = parse(before), b = parse(after);
  if (a === null || b === null) return [];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort().filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

export const MODES: ReadonlyArray<{ value: string; label: string; description: string; badge: string }> = [
  { value: "normal", label: "通常", description: "全機能をフル稼働。", badge: "fn-badge-accent" },
  { value: "economy", label: "省エネ", description: "重い検索や推薦の更新間隔を緩める。", badge: "fn-badge-warning" },
  { value: "read_only", label: "読み取り専用", description: "投稿・更新・通知系を停止し、閲覧のみを許可する。", badge: "fn-badge-warning" },
  { value: "static_only", label: "静的のみ", description: "静的 JSON ベースの閲覧のみ提供する。", badge: "fn-badge-danger" },
  { value: "maintenance", label: "メンテナンス", description: "全機能停止、メンテナンス画面に誘導する。", badge: "fn-badge-danger" },
];

const sectionHeading: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-muted)",
  textTransform: "uppercase", marginBottom: 12,
};

/** Pure view over the API response, testable without a network. */
export function AdminCostGuardView({ data, api, onSuccess }: {
  data: AdminCostGuardResponse; api: AdminCostGuardApi; onSuccess: (message?: string) => void;
}): React.ReactElement {
  const { mode, isMaintenance, updatedAt, history } = data;
  return (
    <div>
      <ConsolePageHeader
        title="コストガード"
        description="実測collectorがないため、自動判定は行わず手動モードと15分限定overrideだけを管理します。"
      />

      <section
        aria-label="現在の状態"
        style={{
          marginTop: 22, padding: "20px 22px", background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}
      >
        <span className={`fn-badge ${MODES.find((m) => m.value === mode)?.badge ?? "fn-badge-soft"}`}>mode: {mode}</span>
        <span className={`fn-badge ${isMaintenance ? "fn-badge-danger" : "fn-badge-soft"}`}>
          メンテナンス: {isMaintenance ? "ON" : "OFF"}
        </span>
        {updatedAt ? (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            最終更新: {new Date(updatedAt * 1000).toLocaleString("ja-JP")}
          </span>
        ) : null}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={sectionHeading}>設定</h2>
        <div style={{ padding: "16px 18px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
          <CostGuardForm settings={data} api={api} onSuccess={onSuccess} />
          <CostGuardOverrideForm settings={data} api={api} onSuccess={onSuccess} />
          <CostGuardDisabledFeaturesForm settings={data} api={api} onSuccess={onSuccess} />
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
        <h2 style={sectionHeading}>変更履歴 (直近 20 件)</h2>
        {history.length === 0 ? (
          <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
            まだ system_settings の変更履歴はありません。
          </p>
        ) : (
          <FnTable>
            <thead>
              <tr><th>日時</th><th>実行者</th><th>変更キー</th></tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const changed = changedCostGuardKeys(h.before_json, h.after_json);
                return (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(h.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatRelative(h.created_at)}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {h.actor_user_id ? (
                        <Link href={`/admin/users/${encodeURIComponent(h.actor_user_id)}`}>{h.actor_user_id}</Link>
                      ) : "-"}
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
                              style={{ marginLeft: 6, padding: "0 6px", height: 22, fontSize: 11 }}
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

const defaultApi = createAdminCostGuardApi();

export function AdminCostGuard({ api = defaultApi }: { api?: AdminCostGuardApi }): React.ReactElement {
  const [refresh, setRefresh] = React.useState(0);
  // The successful write's message must outlive the fail-closed reload below, which
  // unmounts the forms (CURRENT router.refresh() kept the client message).
  const [notice, setNotice] = React.useState<string | null>(null);
  // A failed refresh must never leave privileged controls enabled with stale settings.
  // Treat each refresh as a new read identity instead of retaining last-known data.
  const state = useApiResult((signal) => api.read(signal), "admin-cost-guard:" + refresh);
  const redirect = state.status === "loading" ? null : adminReadRedirect(state);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (state.status === "loading" || state.status === "anonymous" || state.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (state.status !== "ok") {
    // Fail closed: without a read there is no CAS token, so no write form is rendered.
    return (
      <div role="alert" className="fn-alert fn-alert--danger" style={{ marginTop: 20 }}>
        コストガード設定を取得できません（{state.status}）。書き込みは利用できません。{" "}
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => setRefresh((v) => v + 1)}>再試行</button>
      </div>
    );
  }
  return (
    <>
      {notice ? <p role="status" style={{ marginTop: 12, fontSize: 12 }}>{notice}</p> : null}
      <AdminCostGuardView data={state.data} api={api} onSuccess={(message) => { setNotice(message ?? null); setRefresh((v) => v + 1); }} />
    </>
  );
}
