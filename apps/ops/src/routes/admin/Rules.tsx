/** MIG-0727 U03a: unmounted read-only admin rules list / detail candidates.
 * Publishing, archival and reaccept-broadcast require reviewed U03b write parity.
 */
import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { AdminRulesResponse, AdminRuleDetailResponse } from "@flamenode/contracts";
import { formatAnnouncementUnix } from "../../api/adminAnnouncements.js";
import { readAdminRuleDetail, readAdminRules, ruleStatusQuery, type RuleStatus } from "../../api/adminRules.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult } from "../useApiResult.js";

export function AdminRulesView({ data, onStatusChange = () => {} }: {
  data: AdminRulesResponse;
  onStatusChange?: (status: RuleStatus) => void;
}): React.ReactElement {
  return <section className="fn-page" aria-label="規約管理">
    <header className="fn-page-head">
      <h1 className="fn-page-title">規約管理</h1>
      <p className="fn-muted">変更があった場合、影響度に応じて「再同意必須」を設定すると、次回投稿時にユーザーに同意導線を表示します。</p>
      <Link to="/admin/rules/new" className="fn-btn fn-btn-primary">新規バージョン</Link>
    </header>
    <form method="get" role="search" onSubmit={e => e.preventDefault()}>
      <label className="fn-field">状態
        <select className="fn-select" name="status" value={data.status}
          onChange={e => onStatusChange(e.currentTarget.value as RuleStatus)}>
          <option value="any">全状態</option><option value="published">公開中</option>
          <option value="draft">下書き</option><option value="archived">アーカイブ</option>
        </select>
      </label>
    </form>
    <aside className="fn-panel" aria-label="major 公開時の影響範囲">
      <strong>major 公開時の影響範囲 (dry-run)</strong>
      <p>major公開時はユーザー行を一括更新せず、同意履歴から再同意要否を動的判定します。</p>
      <p>現在の再同意待ち: <strong>{data.reacceptRequiredCount.toLocaleString()}
        {data.reacceptCountIsLowerBound ? "件以上" : "件"}</strong></p>
      {data.currentPublished ? <p>公開中: {data.currentPublished.version_label}。通知enqueueは移行準備中です。</p> : null}
      <p className="fn-muted">Discord通知はnotification_outboxに30件ずつ段階enqueueします。送信結果は通知管理で確認できます。</p>
    </aside>
    <div style={{ overflowX: "auto" }}><table className="fn-table">
      <thead><tr><th scope="col">バージョン</th><th scope="col">状態</th><th scope="col">影響度</th>
        <th scope="col">公開日</th><th scope="col">更新</th><th scope="col">操作</th></tr></thead>
      <tbody>
      {data.items.map(item => <tr key={item.id}>
        <td><strong>{item.version_label}</strong></td>
        <td><span className={`fn-badge ${item.status === "published" ? "fn-badge-accent" : item.status === "draft" ? "fn-badge-soft" : "fn-badge-neutral"}`}>
          {item.status === "published" ? "公開中" : item.status === "draft" ? "下書き" : "アーカイブ"}
        </span></td>
        <td><span className={`fn-badge ${item.severity === "major" ? "fn-badge-warning" : "fn-badge-soft"}`}>
          {item.severity === "major" ? "major" : "minor"}
        </span></td>
        <td>{formatAnnouncementUnix(item.published_at, true)}</td>
        <td>{formatAnnouncementUnix(item.updated_at)}</td>
        <td><Link className="fn-btn fn-btn-ghost fn-btn-sm" to={`/admin/rules/${encodeURIComponent(item.id)}/edit`}>詳細</Link>{" "}
          <Link className="fn-btn fn-btn-ghost fn-btn-sm"
            to={`/admin/audit?table=terms_versions&record=${encodeURIComponent(item.id)}`}>監査</Link></td>
      </tr>)}
      {data.items.length === 0 ? <tr><td colSpan={6} className="fn-empty-message">
        規約バージョンがまだ登録されていません。</td></tr> : null}
      </tbody>
    </table></div>
  </section>;
}

export function AdminRulesPage({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const status = ruleStatusQuery(params);
  const result = useApiResult(
    signal => readAdminRules(new URLSearchParams({ status }), fetchFn, signal),
    "admin-rules?status=" + status,
  );
  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<Link to="/entry">ログイン</Link></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<Link to="/dashboard">ダッシュボードへ</Link></p>;
  if (result.status !== "ok") return <p role="alert">規約を取得できませんでした。再読み込みしてください。</p>;
  return <AdminRulesView data={result.data} onStatusChange={next => setParams({ status: next })} />;
}

export function AdminRuleDetailView({ data }: { data: AdminRuleDetailResponse }): React.ReactElement {
  const item = data.item;
  return <section className="fn-page" aria-label="規約バージョン詳細">
    <header className="fn-page-head"><h1 className="fn-page-title">{item.version_label} を編集</h1>
      <Link to="/admin/rules">規約一覧へ</Link></header>
    <p>状態: <span className="fn-badge fn-badge-soft">{item.status ?? "draft"}</span>{" "}
      <span className="fn-badge fn-badge-soft">{item.severity ?? "minor"}</span></p>
    <p role="note" className="fn-muted">編集・公開・アーカイブ操作は移行準備中です。</p>
    <label className="fn-field">バージョン<input className="fn-input" name="version_label"
      value={item.version_label} readOnly /></label>
    <label className="fn-field">本文 (Markdown)<textarea className="fn-input" name="body_markdown"
      value={item.body_markdown} rows={10} readOnly /></label>
  </section>;
}

export function AdminRuleDetailPage({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id = "" } = useParams();
  const result = useApiResult(signal => readAdminRuleDetail(id, fetchFn, signal), "admin-rule-detail:" + id);
  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<Link to="/entry">ログイン</Link></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<Link to="/dashboard">ダッシュボードへ</Link></p>;
  if (result.status === "notFound") return <p role="alert">規約バージョンが見つかりません。</p>;
  if (result.status !== "ok") return <p role="alert">規約を取得できませんでした。再読み込みしてください。</p>;
  return <AdminRuleDetailView data={result.data} />;
}
