import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminAnnouncementListResponse } from "@flamenode/contracts";
import {
  announcementQuery, formatAnnouncementUnix, readAdminAnnouncements,
  type AnnouncementAudience, type AnnouncementStatus,
} from "../../api/adminAnnouncements.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult } from "../useApiResult.js";

type FilterName = "audience" | "status";

/** MIG-0727 U02a: CURRENT /admin/announcements read-only list; unmounted until route ownership clears. */
export function AnnouncementsView({
  data, onFilterChange = () => {},
}: {
  data: AdminAnnouncementListResponse;
  onFilterChange?: (name: FilterName, value: string) => void;
}): React.ReactElement {
  return <section className="fn-page" aria-label="お知らせ管理">
    <header className="fn-page-head">
      <h1 className="fn-page-title">お知らせ管理</h1>
      <p className="fn-muted">サイト内に掲載するユーザー向けお知らせの作成・公開・状態管理を行います。</p>
      <Link to="/admin/announcements/new" className="fn-btn fn-btn-primary">新規お知らせ</Link>
    </header>
    <form method="get" role="search" onSubmit={e => e.preventDefault()}
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <label>対象
        <select name="audience" className="fn-select" value={data.audience}
          onChange={e => onFilterChange("audience", e.currentTarget.value)}>
          <option value="any">対象すべて</option>
          <option value="all">all</option>
          <option value="creators">creators</option>
          <option value="admins">admins</option>
        </select>
      </label>
      <label>公開状態
        <select name="status" className="fn-select" value={data.status}
          onChange={e => onFilterChange("status", e.currentTarget.value)}>
          <option value="any">公開状態すべて</option>
          <option value="published">公開のみ</option>
          <option value="draft">下書きのみ</option>
        </select>
      </label>
    </form>
    <aside className="fn-panel" aria-label="公開側の取得方針">
      <strong>公開側の取得方針</strong>
      <p>公開側は公開済み・掲載期間内・対象allのお知らせを最大3件取得します。Discordへの告知は運営Discord上で行います。</p>
    </aside>
    <div style={{ overflowX: "auto" }}>
      <table className="fn-table"><thead><tr>
        <th scope="col">タイトル</th><th scope="col">公開状態</th>
        <th scope="col">掲載期間</th><th scope="col">更新</th><th scope="col">操作</th>
      </tr></thead><tbody>
        {data.items.map(item => <tr key={item.id}>
          <td><strong>{item.title}</strong><div className="fn-muted fn-text-sm">{item.id.slice(0, 12)}…</div></td>
          <td>{item.is_published === 1
            ? <span className="fn-badge fn-badge-accent">公開</span>
            : <span className="fn-badge fn-badge-soft">下書き</span>}</td>
          <td>{formatAnnouncementUnix(item.publish_at, true)} 〜 {formatAnnouncementUnix(item.expire_at, true)}</td>
          <td>{formatAnnouncementUnix(item.updated_at)}</td>
          <td><Link className="fn-btn fn-btn-sm fn-btn-ghost"
            to={`/admin/announcements/${encodeURIComponent(item.id)}/edit`}>編集</Link>{" "}
            <Link className="fn-btn fn-btn-sm fn-btn-ghost"
              to={`/admin/audit?table=announcements&record=${encodeURIComponent(item.id)}`}>監査</Link></td>
        </tr>)}
        {data.items.length === 0
          ? <tr><td colSpan={5} className="fn-empty-message">お知らせはまだありません。</td></tr>
          : null}
      </tbody></table>
    </div>
  </section>;
}

/** Unmounted candidate: the MIG-0726 owner retains control of the Ops admin router. */
export function AnnouncementsPage({
  fetchFn,
}: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const key = announcementQuery(params);
  const result = useApiResult(
    (signal) => readAdminAnnouncements(new URLSearchParams(key), fetchFn, signal),
    "admin-announcements?" + key,
  );

  function changeFilter(name: FilterName, value: string): void {
    const next = new URLSearchParams(key);
    next.set(name, value);
    setParams(announcementQuery(next));
  }

  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<Link to="/entry">ログイン</Link></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<Link to="/dashboard">ダッシュボードへ</Link></p>;
  if (result.status !== "ok") return <p role="alert">お知らせを取得できませんでした。再読み込みしてください。</p>;
  return <AnnouncementsView data={result.data} onFilterChange={changeFilter} />;
}
