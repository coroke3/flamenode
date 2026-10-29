import * as React from "react";
import { computeEventStatus, eventStatusBadgeClass, eventStatusLabel } from "@flamenode/domain/event/status";
import type { ManageDashboardResponse, ManageDashboardEvent } from "@flamenode/contracts";
import { loadManageDashboard } from "../../api/manageDashboard.js";
import { useApiResult } from "../useApiResult.js";
import { AUTH_UNAVAILABLE } from "../guard.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { Icon } from "../../components/shared/Icon.js";
import { NotificationOutboxSummary } from "../../components/notifications/NotificationOutboxSummary.js";
import { ManageActiveXNotice } from "./ManageActiveXNotice.js";

export function manageDashboardRedirect(status: string, reason?: string): string | null {
  if (status === "anonymous") return "/entry?next=%2Fmanage";
  if (status === "forbidden" && reason === "manage_access_required") return "/dashboard";
  if (status === "forbidden" || status === "unavailable" || status === "unsupported") return AUTH_UNAVAILABLE;
  return null;
}
export function manageKpiClasses(data: Pick<ManageDashboardResponse, "pendingReviewTotal" | "failedNotificationCount">): { pending: string; failed: string } {
  return { pending: "manage-dashboard-kpi" + (data.pendingReviewTotal > 0 ? " manage-dashboard-kpi--warn" : ""), failed: "manage-dashboard-kpi" + (data.failedNotificationCount > 0 ? " manage-dashboard-kpi--danger" : "") };
}
function formatted(value: number | null | undefined): string { return value == null ? "—" : new Date(value * 1000).toLocaleString("ja-JP"); }
function dateOnly(value: number | null | undefined): string { return value == null ? "—" : new Date(value * 1000).toLocaleDateString("ja-JP"); }
function EventCard({ ev, isAdmin }: { ev: ManageDashboardEvent; isAdmin: boolean }): React.ReactElement {
  const status = computeEventStatus(ev);
  const pending = ev.pending_review_count;
  const href = "/manage/events/" + encodeURIComponent(ev.id);
  return <article className="manage-event-card manage-event-status-card" style={ev.accent_color ? { "--event-accent": ev.accent_color } as React.CSSProperties : undefined}>
    <div className="fn-console-event-body">
      <div className="fn-console-event-title-row"><Link href={href}>{ev.title}</Link><span className={"fn-badge " + eventStatusBadgeClass(status)}>{eventStatusLabel(status)}</span>
        {!isAdmin ? <span className="fn-badge fn-badge-soft">{ev.staff_role === "representative" ? "代表" : "運営"}</span> : null}
        {pending > 0 ? <span className="fn-badge fn-badge-warning">審査待ち {pending}</span> : null}
      </div>
      <div className="fn-console-event-meta manage-event-status-meta"><span>{dateOnly(ev.start_time)}{ev.end_time ? " 〜 " + dateOnly(ev.end_time) : ""}</span>
        {pending > 0 ? <span className="manage-event-status-pending">審査待ち作品 {pending} 件</span> : <span className="manage-event-status-ok">審査待ちなし</span>}
      </div>
    </div>
    <div className="manage-actions">
      <Link href={href} className="fn-btn fn-btn-ghost fn-btn-sm">運営トップ</Link>
      <Link href={href + "/videos?status=pending"} className={"fn-btn fn-btn-sm " + (pending > 0 ? "fn-btn-primary" : "fn-btn-ghost")}><Icon name="check" size={12} aria-hidden />{pending > 0 ? "審査 (" + pending + ")" : "審査"}</Link>
      <Link href={href + "/slots"} className="fn-btn fn-btn-ghost fn-btn-sm">枠</Link>
      <Link href={"/event/" + encodeURIComponent(ev.id)} className="fn-btn fn-btn-ghost fn-btn-sm">公開ページ</Link>
      {isAdmin ? <Link href={href + "/edit"} className="fn-btn fn-btn-ghost fn-btn-sm"><Icon name="settings" size={12} aria-hidden /> 設定</Link> : null}
    </div>
  </article>;
}
export function ManageDashboardContent({ data }: { data: ManageDashboardResponse }): React.ReactElement {
  const { access, events } = data;
  const classes = manageKpiClasses(data);
  if (!events.length) return <div className="manage-dashboard">
    <ConsolePageHeader title="イベント運営" description="担当イベントの現場運用（審査・枠・通知）です。" accent />
    <EmptyState tone="warning" title="担当イベントはありません"
      description={access.isAdmin ? "イベント運営者として登録されると、この画面から審査・枠・通知を確認できます。管理者はイベントを作成し、運営メンバーを割り当ててください。" : "イベント主催者にあなたの X ID を運営メンバーとして登録してもらうと、この画面から審査・枠・通知を確認できるようになります。"}
      actions={access.isAdmin ? [{ href: "/admin/events", label: "イベント管理へ", variant: "primary" }, { href: "/admin/events/new", label: "新規イベントを作成", variant: "ghost" }] : [{ href: "/dashboard", label: "ダッシュボードへ", variant: "primary" }, { href: "/dashboard/settings", label: "X ID 設定を確認", variant: "ghost" }]} />
  </div>;
  return <div className="manage-dashboard">
    {!access.isAdmin ? <ManageActiveXNotice activeXUserId={data.activeXUserId} manageStaffXUserIds={data.manageStaffXUserIds} /> : null}
    <ConsolePageHeader title="イベント運営" description="あなたが担当するイベントの状態・審査待ち・関連履歴を表示します。" accent>
      <Link href="/manage/notifications" className="fn-btn fn-btn-ghost fn-btn-sm"><Icon name="alert" size={11} aria-hidden /> 通知センター</Link>
      {access.canManageXIdLinkRequests ? <Link href="/manage/x-link-requests" className="fn-btn fn-btn-ghost fn-btn-sm"><Icon name="user" size={11} aria-hidden /> X ID 連携申請</Link> : null}
    </ConsolePageHeader>
    <section className="manage-dashboard-summary" aria-labelledby="manage-summary-title">
      <div className="manage-dashboard-summary-copy"><p className="manage-dashboard-eyebrow">OPERATIONS OVERVIEW</p><h2 id="manage-summary-title">運営の全体像</h2><p>担当イベントの状態をひと目で確認し、必要な作業へ移動できます。</p></div>
      <div className="manage-dashboard-kpi-grid">
        <div className="manage-dashboard-kpi"><span>担当イベント</span><strong>{events.length.toLocaleString()}</strong></div>
        <div className={classes.pending}><span>審査待ち</span><strong>{data.pendingReviewTotal.toLocaleString()}</strong></div>
        <div className="manage-dashboard-kpi"><span>受付中</span><strong>{data.acceptingEventCount.toLocaleString()}</strong></div>
        <div className={classes.failed}><span>通知失敗</span><strong>{data.failedNotificationCount.toLocaleString()}</strong></div>
      </div>
    </section>
    {data.failedNotificationCount > 0 ? <div role="status" className="fn-alert fn-alert--danger"><strong>担当イベントに失敗通知が {data.failedNotificationCount} 件</strong>あります。 <Link href="/manage/notifications?status=failed">通知センターで確認 →</Link></div> : null}
    {data.notificationSchemaMissing ? <div role="status" className="fn-alert fn-alert--warn">イベント通知の絞り込みに必要な DB migration が未適用です。ローカルでは npm.cmd run db:local-apply を実行してください。</div> : null}
    {data.eventsTruncated ? <div role="status" className="fn-alert fn-alert--warn">表示件数の上限に達しました。残りの担当イベントはここに表示されない場合があります。</div> : null}
    <section className="fn-console-section fn-console-section--tight"><h2 className="fn-console-eyebrow">運営状況一覧</h2><div className="fn-console-stack">{events.map(ev => <EventCard key={ev.id} ev={ev} isAdmin={access.isAdmin} />)}</div></section>
    {data.notifications.length > 0 ? <section className="fn-console-section"><h2 className="fn-console-eyebrow">イベント通知（直近）</h2>
      <FnTable className="manage-event-notifications-table"><thead><tr><th>通知</th><th>日時</th><th>イベント</th></tr></thead><tbody>
        {data.notifications.map(n => { const ev = events.find(item => item.id === n.event_id); return <tr key={n.id}><td><NotificationOutboxSummary row={n} /></td><td className="fn-td-nowrap">{formatted(n.created_at)}</td><td>{ev ? <Link href={"/manage/events/" + encodeURIComponent(ev.id)}>{ev.title}</Link> : n.event_id ? n.event_id.slice(0, 8) + "…" : "—"}</td></tr>; })}
      </tbody></FnTable></section> : null}
    <section className="fn-console-section"><h2 className="fn-console-eyebrow">受信箱 (担当イベント関連の更新履歴)</h2>
      {data.inbox.length === 0 ? <EmptyState tone="success" title="直近の更新はありません" description="担当イベントに関する履歴更新は、ここに表示されます。問題がなければこのままで大丈夫です。" iconName="check" actions={[{ href: "/manage", label: "イベント運営トップへ", variant: "ghost" }]} /> :
        <FnTable><thead><tr><th>日時</th><th>イベント</th><th>操作</th><th>実行者</th></tr></thead><tbody>{data.inbox.map(h => { const ev = events.find(item => item.id === h.target_id); return <tr key={h.id}><td className="fn-td-nowrap">{formatted(h.created_at)}</td><td>{ev ? <Link href={"/event/" + encodeURIComponent(ev.id)}>{ev.title}</Link> : h.target_id}</td><td><span className={"fn-badge " + (h.operation === "DELETE" ? "fn-badge-danger" : h.operation === "CREATE" ? "fn-badge-accent" : "fn-badge-soft")}>{h.operation}</span></td><td>{h.actor_user_id ?? "-"}</td></tr>; })}</tbody></FnTable>}
    </section>
  </div>;
}
export function ManageDashboard({ fetchFn = fetch }: { fetchFn?: typeof fetch }): React.ReactElement {
  const result = useApiResult(signal => loadManageDashboard(fetchFn, signal), "manage-dashboard");
  const redirect = manageDashboardRedirect(result.status, result.status === "forbidden" ? result.reason : undefined);
  React.useEffect(() => { if (redirect) window.location.assign(redirect); }, [redirect]);
  if (result.status === "ok") return <ManageDashboardContent data={result.data} />;
  if (result.status === "loading" || redirect) return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status === "notFound") return <EmptyState tone="warning" title="担当イベントが見つかりません" />;
  return <div role="alert">データを読み込めませんでした。</div>;
}
