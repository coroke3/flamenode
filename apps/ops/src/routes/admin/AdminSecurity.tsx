/** MIG-0736 U01. Explicit run=1 is required before security diagnostics query D1. */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminSecurityResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import { getAdminSecurity } from "../../api/adminDiagnostics.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";
import { DiagnosticStatusResults, normalizeDiagnosticFilter, type DiagnosticFilter } from "./DiagnosticStatusResults.js";

// CURRENT runSecurityChecks and the mounted Hono /ops/security?run=1
// both return these ten check identities, including the two static INFO rows.
// A shape-valid but incomplete receipt must not be shown as an all-clear.
const SECURITY_CHECK_IDS = [
  "access_token_not_null",
  "rejected_xid_active",
  "unapproved_creator_videos",
  "banned_user_videos",
  "tos_not_accepted_user_videos",
  "custom_page_dangerous_html",
  "banned_user_chapters",
  "orphan_approved_xid",
  "public_api_leak",
  "notification_table_mismatch",
] as const;

// Preserve each CURRENT/Hono check's count/status contract, including the
// intentional INFO rows and the orphan-check failure warning. Never show a
// reassuring summary for a complete but contradictory receipt.
function hasCompleteSecurityResults(results: AdminSecurityResponse["results"]): boolean {
  if (results.length !== SECURITY_CHECK_IDS.length) return false;
  const ids = new Set(results.map(result => result.id));
  if (!SECURITY_CHECK_IDS.every(id => ids.has(id))) return false;
  return results.every(({ id, status, count }) => {
    if (!Number.isSafeInteger(count) || count < 0) return false;
    switch (id) {
      case "access_token_not_null":
      case "rejected_xid_active":
      case "unapproved_creator_videos":
      case "banned_user_videos":
      case "tos_not_accepted_user_videos":
      case "banned_user_chapters":
        return status === (count === 0 ? "ok" : "warn");
      case "custom_page_dangerous_html":
        return count === 0 && status === "ok";
      case "orphan_approved_xid":
        // A failed check is WARN/1 in both CURRENT and Hono.
        return status === (count === 0 ? "ok" : "info") || (count === 1 && status === "warn");
      case "public_api_leak":
      case "notification_table_mismatch":
        return count === 0 && status === "info";
      default:
        return false;
    }
  });
}

export function AdminSecurityView({
  data, shouldRun, initialFilter, onRefresh,
}: {
  data: OpsDataState<AdminSecurityResponse>;
  shouldRun: boolean;
  initialFilter: DiagnosticFilter;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div>
      <ConsolePageHeader title="セキュリティチェック"
        description="権限・認証状態の整合性を読み取り専用で点検します。初期表示では実行せず、必要なときだけ明示的に実行します。" />
      {!shouldRun ? (
        <section className="fn-card" style={{ marginTop: 18 }}>
          <strong>セキュリティ診断は未実行です</strong>
          <p className="fn-muted" style={{ margin: "6px 0 12px", fontSize: 12, lineHeight: 1.6 }}>
            認証・権限関連の全件検査はD1読み取りが多いため、必要なときだけ実行してください。
          </p>
          <OpsLink href="/admin/security?run=1" className="fn-btn fn-btn-primary">
            セキュリティ診断を実行
          </OpsLink>
        </section>
      ) : data.status === "loading" ? <p role="status">読み込み中…</p>
        : data.status === "ok" && data.data.error === null && data.data.ran && hasCompleteSecurityResults(data.data.results) ? (
          <DiagnosticStatusResults kind="security" results={data.data.results}
            initialFilter={initialFilter} onRefresh={onRefresh} />
        ) : <p role="alert" style={{ marginTop: 20 }}>
          {data.status === "anonymous" ? "ログインが必要です。"
            : data.status === "forbidden" || data.status === "notFound" ? "閲覧権限がありません。"
            : "診断結果を取得できませんでした。"}
        </p>}
    </div>
  );
}

export function AdminSecurity({ fetchFn = fetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  // Match CURRENT scalar searchParams; duplicate keys do not opt in.
  const run = params.getAll("run");
  const status = params.getAll("status");
  const shouldRun = run.length === 1 && run[0] === "1";
  const initialFilter = normalizeDiagnosticFilter(status.length === 1 ? status[0] : null);
  const data = useApiResult(
    (signal) => getAdminSecurity(fetchFn, shouldRun, signal),
    shouldRun ? "admin-security:run" : "admin-security:idle",
    refreshKey,
  );
  return <AdminSecurityView data={data} shouldRun={shouldRun} initialFilter={initialFilter}
    onRefresh={() => setRefreshKey((key) => key + 1)} />;
}
