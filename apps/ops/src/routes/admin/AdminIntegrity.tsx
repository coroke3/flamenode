/** MIG-0736 U02c: isolated integrity screen; backend parity/route mount waits for MIG-0626. */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminIntegrityResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import { getAdminIntegrity } from "../../api/adminDiagnostics.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";

/** Deliberately does not invent check results: the current Hono run=1 still returns 501. */
export function AdminIntegrityView({ data, shouldRun, onRefresh }: {
  data: OpsDataState<AdminIntegrityResponse>;
  shouldRun: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div>
      <ConsolePageHeader title="DB 整合性チェック"
        description="videos / video_events / video_members / slots / 派生行 / audit_logs の参照整合性を読み取り専用で確認します。"
        backHref="/admin/health" backLabel="ヘルスチェックへ" />
      <AdminSectionTabs hub="health" />
      {!shouldRun ? (
        <section className="fn-card" style={{ marginTop: 18 }}>
          <strong>DB整合性診断は未実行です</strong>
          <p className="fn-muted" style={{ margin: "6px 0 12px", fontSize: 12 }}>
            全件走査を含む診断です。必要なときだけ実行してください。
          </p>
          <OpsLink href="/admin/health/integrity?run=1" className="fn-btn fn-btn-primary">
            DB整合性診断を実行
          </OpsLink>
        </section>
      ) : (
        <>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
            style={{ marginTop: 16 }} onClick={onRefresh}>最新状態で再チェック</button>
          {data.status === "loading" ? <p role="status">読み込み中…</p> : (
            <p role={data.status === "ok" ? "status" : "alert"} style={{ marginTop: 16 }}>
              {data.status === "unsupported" ? "DB整合性診断は現在利用できません。"
                : data.status === "anonymous" ? "ログインが必要です。"
                : data.status === "forbidden" || data.status === "notFound" ? "閲覧権限がありません。"
                : data.status === "ok" && data.data.ran === false
                  ? "診断は実行されませんでした。"
                  : "診断結果を取得できませんでした。"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function AdminIntegrity({ fetchFn = fetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const shouldRun = params.get("run") === "1";
  const data = useApiResult(
    (signal) => getAdminIntegrity(fetchFn, shouldRun, signal),
    shouldRun ? "admin-integrity:run" : "admin-integrity:idle",
    refreshKey,
  );
  return <AdminIntegrityView data={data} shouldRun={shouldRun}
    onRefresh={() => setRefreshKey((key) => key + 1)} />;
}
