import * as React from "react";
import { Link } from "react-router-dom";
import type { AdminYoutubeQuotaResponse } from "@flamenode/contracts";
import { readYoutubeQuota } from "../../api/adminStaticBuilds.js";
import { AdminVideoManagementTabs } from "../../components/admin/AdminVideoManagementTabs.js";

export function YoutubeQuota(): React.ReactElement {
  const [data, setData] = React.useState<AdminYoutubeQuotaResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    void readYoutubeQuota(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === "ok") { setData(result.data); setError(null); }
      else { setData(null); setError(result.status === "anonymous" ? "再ログインが必要です。" : "quota情報を取得できませんでした。"); }
    });
    return () => controller.abort();
  }, [refresh]);
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head"><h1>YouTube quota</h1>
      <p>単一APIキー。Google Cloud Consoleの日次上限の80%以内で共有管理します。</p></header>
    <AdminVideoManagementTabs />
    <button type="button" className="fn-btn fn-btn-primary"
      onClick={() => setRefresh(id => id + 1)}>最新状態へ更新</button>
    <Link to="/admin/workers" className="fn-btn fn-btn-ghost">Worker監視</Link>
    {error && <p role="alert">{error}</p>}
    {data && <>
      {data.error && <p role="alert">quota情報の取得に失敗しました。</p>}
      <dl className="fn-card" style={{ padding: 16 }}>
        {[
          ["quota日（太平洋時間）", data.quotaDay],
          ["Google設定値", data.configuredUnits.toLocaleString() + " units"],
          ["FlameNode上限（80%）", data.budgetUnits.toLocaleString() + " units"],
          ["推定使用量", data.usedUnits.toLocaleString() + " units"],
          ["残り予算", data.remainingUnits.toLocaleString() + " units"],
          ["使用率", data.usagePercent + "%"],
        ].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
      </dl>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>運用条件</h2>
        <p>APIキーは単一。1回の同期は最大200作品、videos.list最大4回。再試行込みの外部呼び出しは最大8回、逐次実行。</p>
        <p>最終更新: {data.updatedAt == null ? "—" : new Date(data.updatedAt * 1000).toLocaleString("ja-JP")}</p>
        <p>これは予約・使用した推定値であり、Google側の実残量はCloud Consoleを正本としてください。</p>
        <a href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas"
          target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost">YouTube API Quotas</a>
      </section>
    </>}
  </div>;
}
