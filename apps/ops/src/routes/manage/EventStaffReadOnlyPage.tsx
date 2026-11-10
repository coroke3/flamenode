import * as React from "react";
import { Link } from "react-router-dom";
import type { ManageStaffResponse } from "@flamenode/contracts";
import { readManageStaff } from "../../api/manageStaff.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { EventStaffReadOnlyList } from "./EventStaffReadOnlyList.js";
import { EventStaffManager } from "./EventStaffManager.js";

/** The read-only U01a view: mutation controls are intentionally not implemented here. */
export function EventStaffReadOnlyView({ eventId, data, manager }: {
  eventId: string; data: ManageStaffResponse; manager?: React.ReactNode;
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
      {manager ?? (
      <div className="manage-permission-panel">
        <div className="manage-permission-members">
          <div className="manage-staff-list-head">
            <h2 className="fn-console-card-title">登録メンバー ({data.members.length} 件表示)</h2>
            <span className="fn-badge fn-badge-neutral">閲覧のみ</span>
          </div>
          <EventStaffReadOnlyList members={data.members} />
        </div>
      </div>
      )}
      {data.membersTruncated && <p role="status">メンバーが100件を超えています。一覧は先頭100件のみ表示します。</p>}
      {!data.canManageMembers && <p className="fn-alert manage-readonly-alert">
        この画面は閲覧のみです。メンバーの追加・編集には event.members 権限が必要です。
      </p>}
      {data.canManageMembers && !manager && <p className="fn-console-note">
        メンバーの追加・編集機能は移行中です。現行の管理画面を利用してください。
      </p>}
    </section>
  </div>;
}

/** A previous event/fetch identity must never become visible before useEffect clears it. */
export interface StaffReadSnapshot {
  eventId: string;
  fetchFn?: OpsFetch;
  refreshKey?: number;
  contextEpoch?: number;
  result: OpsResult<ManageStaffResponse>;
}
export function currentStaffResult(eventId: string, fetchFn: OpsFetch | undefined, snapshot: StaffReadSnapshot | null, refreshKey = 0, contextEpoch = 0): OpsResult<ManageStaffResponse> | null {
  return snapshot?.eventId === eventId && snapshot.fetchFn === fetchFn &&
    (snapshot.refreshKey ?? 0) === refreshKey &&
    (snapshot.contextEpoch ?? 0) === contextEpoch ? snapshot.result : null;
}

export function EventStaffReadOnlyPage({ eventId, fetchFn, editable = false }: {
  eventId: string; fetchFn?: OpsFetch; editable?: boolean;
}): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<StaffReadSnapshot | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  // Render-phase identity fence: event A -> B -> A must never reaccept the
  // old event A snapshot before passive effect cleanup runs.
  const identityRef = React.useRef({ eventId, fetchFn, refreshKey, epoch: 0 });
  if (identityRef.current.eventId !== eventId ||
      identityRef.current.fetchFn !== fetchFn ||
      identityRef.current.refreshKey !== refreshKey) {
    identityRef.current = { eventId, fetchFn, refreshKey, epoch: identityRef.current.epoch + 1 };
  }
  const contextEpoch = identityRef.current.epoch;
  React.useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    void readManageStaff(eventId, fetchFn, controller.signal).then(result => {
      if (!controller.signal.aborted) setSnapshot({ eventId, fetchFn, refreshKey, contextEpoch, result });
    });
    return () => controller.abort();
  }, [eventId, fetchFn, refreshKey, contextEpoch]);
  // React passive effects run after paint. Guard synchronously during render as well.
  const result = currentStaffResult(eventId, fetchFn, snapshot, refreshKey, contextEpoch);
  if (result === null) return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status === "notFound") return <p role="alert">イベントまたは運営権限が見つかりません。</p>;
  if (result.status !== "ok") return <p role="alert">運営メンバーを取得できませんでした。再ログインまたは再読み込みしてください。</p>;
  const data = result.data;
  // Never edit a truncated 100+ member snapshot. The authoritative Hono
  // handlers still recheck permissions, owner-count CAS and audit.
  const manager = editable && data.canManageMembers && !data.membersTruncated
    ? <EventStaffManager eventId={eventId} members={data.members}
        ownerCount={data.ownerCount} canManageMembers={data.canManageMembers}
        isSiteAdmin={data.isAdmin} fetchFn={fetchFn}
        onRefresh={() => setRefreshKey(value => value + 1)} />
    : undefined;
  return <EventStaffReadOnlyView eventId={eventId} data={data} manager={manager} />;
}
