import * as React from "react";
import { Link } from "react-router-dom";
import type { ManageStaffResponse } from "@flamenode/contracts";
import { readManageStaff } from "../../api/manageStaff.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { EventStaffReadOnlyList } from "./EventStaffReadOnlyList.js";

/** The read-only U01a view: mutation controls are intentionally not implemented here. */
export function EventStaffReadOnlyView({ eventId, data }: {
  eventId: string; data: ManageStaffResponse;
}): React.ReactElement {
  const encodedId = encodeURIComponent(eventId);
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <h1>{data.event.title} — 運営メンバー</h1>
      <p>権限は担当プリセット、公開ページの肩書は公開肩書から解決します。</p>
      <Link to={"/manage/events/" + encodedId}>イベント概要へ</Link>
    </header>
    <section aria-label="運営メンバー概要" className="fn-console-stat-grid fn-console-section--tight">
      <article className="fn-card fn-console-stat"><h2>代表者</h2><strong>{data.ownerCount}</strong></article>
      <article className="fn-card fn-console-stat"><h2>登録メンバー</h2><strong>{data.membersTruncated ? "100+" : data.members.length}</strong></article>
      <article className="fn-card fn-console-stat"><h2>公開メンバー</h2><strong>{data.publicCount}</strong></article>
      <article className="fn-card fn-console-stat"><h2>承認済みX名義</h2><strong>{data.approvedCount}</strong></article>
    </section>
    <section className="manage-section">
      <div className="manage-permission-panel">
        <div className="manage-permission-members">
          <div className="manage-staff-list-head">
            <h2 className="fn-console-card-title">登録メンバー ({data.members.length} 件表示)</h2>
            <span className="fn-badge fn-badge-neutral">閲覧のみ</span>
          </div>
          <EventStaffReadOnlyList members={data.members} />
        </div>
      </div>
      {data.membersTruncated && <p role="status">メンバーが100件を超えています。一覧は先頭100件のみ表示します。</p>}
      {!data.canManageMembers && <p className="fn-alert manage-readonly-alert">
        この画面は閲覧のみです。メンバーの追加・編集には event.members 権限が必要です。
      </p>}
      {data.canManageMembers && <p className="fn-console-note">
        メンバーの追加・編集機能は移行中です。現行の管理画面を利用してください。
      </p>}
    </section>
  </div>;
}

export function EventStaffReadOnlyPage({ eventId, fetchFn }: {
  eventId: string; fetchFn?: OpsFetch;
}): React.ReactElement {
  const [result, setResult] = React.useState<OpsResult<ManageStaffResponse> | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null); // Deny cross-event and cross-account cached display while fetching.
    void readManageStaff(eventId, fetchFn, controller.signal).then(next => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [eventId, fetchFn]);
  if (result === null) return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status === "notFound") return <p role="alert">イベントまたは運営権限が見つかりません。</p>;
  if (result.status !== "ok") return <p role="alert">運営メンバーを取得できませんでした。再ログインまたは再読み込みしてください。</p>;
  return <EventStaffReadOnlyView eventId={eventId} data={result.data} />;
}
