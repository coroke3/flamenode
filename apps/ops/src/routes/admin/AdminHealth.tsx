/** MIG-0736 U01. Not mounted until the Ops Admin shell and diagnostic back end are ready. */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminHealthResponse } from "@flamenode/contracts";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { getAdminHealth } from "../../api/adminDiagnostics.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";
import { DiagnosticStatusResults, normalizeDiagnosticFilter, type DiagnosticFilter } from "./DiagnosticStatusResults.js";

// CURRENT runOperationalHealthChecks and Hono GET /ops/health return these five
// identities. A valid DTO with missing, duplicate or unexpected rows is not
// a complete operational diagnosis, even when its HTTP status is 200.
const OPERATIONAL_CHECK_IDS = [
  "system_settings_single_row",
  "notification_processing_stuck",
  "notification_failed_volume",
  "open_moderation_cases_overdue",
  "x_id_merge_pending_stale",
] as const;

function hasCompleteOperationalResults(results: AdminHealthResponse["results"]): boolean {
  if (results.length !== OPERATIONAL_CHECK_IDS.length) return false;
  const ids = new Set(results.map(result => result.id));
  return OPERATIONAL_CHECK_IDS.every(id => ids.has(id));
}

export function AdminHealthView({
  data, fullRun, initialFilter, onRefresh,
}: {
  data: OpsDataState<AdminHealthResponse>;
  fullRun: boolean;
  initialFilter: DiagnosticFilter;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div>
      <ConsolePageHeader title="DB ヘルスチェック"
        description="データベースの整合性を読み取り専用で点検します。修復操作はありません。" />
      <AdminSectionTabs hub="health" />
      <section className="fn-card" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div><strong>{fullRun ? "全体診断" : "運用チェック"}</strong>
          <p className="fn-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            {fullRun ? "参照切れ、派生行欠落、枠状態矛盾を含む全項目を確認しています。"
              : "通知・モデレーション・設定など、通常運用に必要な項目だけを確認します。詳細診断は明示的に実行してください。"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {fullRun ? <OpsLink href="/admin/health" className="fn-btn fn-btn-ghost">通常の運用チェックへ戻る</OpsLink>
            : <OpsLink href="/admin/health?deep=1" className="fn-btn fn-btn-primary">全体診断を実行</OpsLink>}
          <OpsLink href="/admin/health/integrity" className="fn-btn fn-btn-ghost">DB整合性チェックへ</OpsLink>
        </div>
      </section>
      {/* MIG-0626 may return a catalog with zero results before any check runs.
          Until U03, never display an empty deep response as an all-clear. */}
      {data.status === "loading" ? <p role="status">読み込み中…</p>
        : data.status === "ok" && data.data.error === null && (fullRun ? data.data.results.length > 0 : hasCompleteOperationalResults(data.data.results)) ? (
          <DiagnosticStatusResults kind="health" results={data.data.results}
            initialFilter={initialFilter} onRefresh={onRefresh} />
        ) : (
          <p role="alert" style={{ marginTop: 20 }}>
            {data.status === "unsupported" || (fullRun && data.status === "ok" && data.data.error === null && data.data.results.length === 0)
              ? "全体診断は現在利用できません。"
              : data.status === "anonymous" ? "ログインが必要です。"
              : data.status === "forbidden" || data.status === "notFound" ? "閲覧権限がありません。"
              : "診断結果を取得できませんでした。"}
          </p>
        )}
    </div>
  );
}

export function AdminHealth({ fetchFn = fetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  // CURRENT Next searchParams supplies arrays for duplicate keys; only a
  // single scalar "1" requests the expensive diagnostic for each alias.
  const deep = params.getAll("deep");
  const run = params.getAll("run");
  const status = params.getAll("status");
  const fullRun = (deep.length === 1 && deep[0] === "1") ||
    (run.length === 1 && run[0] === "1");
  const initialFilter = normalizeDiagnosticFilter(status.length === 1 ? status[0] : null);
  const data = useApiResult(
    (signal) => getAdminHealth(fetchFn, fullRun, signal),
    fullRun ? "admin-health:deep" : "admin-health:operational",
    refreshKey,
  );
  return <AdminHealthView data={data} fullRun={fullRun} initialFilter={initialFilter}
    onRefresh={() => setRefreshKey((key) => key + 1)} />;
}
