import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canManageXIdLinkRequests,
  getEditableEventIds,
  getManageStaffRolesForEvents,
} from "@/lib/auth/ownership";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import {
  events as eventsTable,
  auditLogs as auditLogsTable,
  notificationOutbox as notificationOutboxTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { NotificationOutboxSummary } from "@/components/notifications/NotificationOutboxSummary";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as ManagePageHeader } from "@/components/layout/ConsolePageHeader";

export const metadata: Metadata = { title: "イベント運営" };
export const dynamic = "force-dynamic";

// D1は1 statement最大100 bindings。status等の固定条件にもbindを使うため余裕を持たせる。
const D1_SAFE_EVENT_ID_CHUNK_SIZE = 80;

function chunkEventIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += D1_SAFE_EVENT_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + D1_SAFE_EVENT_ID_CHUNK_SIZE));
  }
  return chunks;
}

export default async function ManageTopPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/manage" });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) {
    return (
      <div className="manage-dashboard">
        <ManagePageHeader
          title="イベント運営"
          description="DB に接続できませんでした。"
          accent
        />
      </div>
    );
  }

  const isAdmin = user.role === "admin";
  /** ManageSidebar / canAccessManageEvent と同じ一覧（Active X 非依存） */
  const editableEventIds = isAdmin ? [] : await getEditableEventIds(db, user.id);

  let eventRows: (typeof eventsTable.$inferSelect)[];
  if (isAdmin) {
    eventRows = await db
      .select()
      .from(eventsTable)
      .orderBy(
        desc(eventsTable.start_time),
        desc(eventsTable.created_at),
        desc(eventsTable.id),
      );
  } else {
    eventRows = [];
    // 担当イベント数をそのままINへ展開せず、全chunk成功後に同じ表示順へ戻す。
    for (const eventIdChunk of chunkEventIds(editableEventIds)) {
      const rows = await db
        .select()
        .from(eventsTable)
        .where(inArray(eventsTable.id, eventIdChunk))
        .orderBy(
          desc(eventsTable.start_time),
          desc(eventsTable.created_at),
          desc(eventsTable.id),
        );
      eventRows.push(...rows);
    }
  }
  eventRows.sort(compareEventsByUpcomingPriority);
  const eventIds = eventRows.map((event) => event.id);

  // 各イベントごとの審査待ち件数
  const pendingByEvent = new Map<string, number>();
  for (const eventIdChunk of chunkEventIds(eventIds)) {
    const rows = await db
      .select({
        event_id: videoEventsTable.event_id,
        c: sql<number>`COUNT(*)`,
      })
      .from(videosTable)
      .innerJoin(
        videoEventsTable,
        eq(videoEventsTable.video_id, videosTable.id),
      )
      .where(
        and(
          inArray(videoEventsTable.event_id, eventIdChunk),
          eq(videosTable.visibility_status, "pending"),
        )!,
      )
      .groupBy(videoEventsTable.event_id);
    for (const r of rows) {
      pendingByEvent.set(r.event_id, Number(r.c ?? 0));
    }
  }

  // 担当イベント関連の audit_logs を直近で取得 (event_id を target_id として参照する記録)
  const recentInboxCandidates: (typeof auditLogsTable.$inferSelect)[] = [];
  for (const eventIdChunk of chunkEventIds(eventIds)) {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.table_name, "events"),
          inArray(auditLogsTable.target_id, eventIdChunk),
        )!,
      )
      .orderBy(desc(auditLogsTable.created_at))
      .limit(20);
    recentInboxCandidates.push(...rows);
  }
  const recentInbox = recentInboxCandidates
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, 20);

  // event-scoped 通知 (notification_outbox.event_id が担当イベントに該当するもの)
  // 古いローカル D1 では event_id migration 未適用のことがあるため、ページ全体は落とさない。
  let eventNotifications: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let eventNotificationSchemaMissing = false;
  if (eventIds.length > 0) {
    try {
      const candidates: (typeof notificationOutboxTable.$inferSelect)[] = [];
      for (const eventIdChunk of chunkEventIds(eventIds)) {
        const rows = await db
          .select()
          .from(notificationOutboxTable)
          .where(inArray(notificationOutboxTable.event_id, eventIdChunk))
          .orderBy(desc(notificationOutboxTable.created_at))
          .limit(20);
        candidates.push(...rows);
      }
      eventNotifications = candidates
        .sort((left, right) => right.created_at - left.created_at)
        .slice(0, 20);
    } catch (e) {
      eventNotificationSchemaMissing = true;
      console.warn("[ManageTopPage] notification_outbox.event_id unavailable", e);
    }
  }

  // failed 件数集計 (担当イベント分のみ)
  const failedCount = eventNotifications.filter((n) => n.status === "failed").length;
  const canManageXLinks = await canManageXIdLinkRequests(db, {
    id: user.id,
    role: user.role ?? null,
  });

  const pendingReviewTotal = [...pendingByEvent.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const acceptingEventCount = eventRows.filter((event) =>
    isAcceptingEntries(event),
  ).length;

  const staffRoleByEvent = new Map<string, "representative" | "editor">();
  if (!isAdmin) {
    for (const eventIdChunk of chunkEventIds(eventIds)) {
      const roles = await getManageStaffRolesForEvents(db, user.id, eventIdChunk);
      for (const [eventId, role] of roles) staffRoleByEvent.set(eventId, role);
    }
  }

  if (eventIds.length === 0) {
    return (
      <div className="manage-dashboard">
        <ManagePageHeader
          title="イベント運営"
          description="担当イベントの現場運用（審査・枠・通知）です。"
          accent
        />
        <EmptyState
          tone="warning"
          title="担当イベントはありません"
          description={
            isAdmin
              ? "イベント運営者として登録されると、この画面から審査・枠・通知を確認できます。管理者はイベントを作成し、運営メンバーを割り当ててください。"
              : "イベント主催者にあなたの X ID を運営メンバーとして登録してもらうと、この画面から審査・枠・通知を確認できるようになります。"
          }
          actions={
            isAdmin
              ? [
                  { href: "/admin/events", label: "イベント管理へ", variant: "primary" },
                  { href: "/admin/events/new", label: "新規イベントを作成", variant: "ghost" },
                ]
              : [
                  { href: "/dashboard", label: "ダッシュボードへ", variant: "primary" },
                  {
                    href: "/dashboard/settings",
                    label: "X ID 設定を確認",
                    variant: "ghost",
                  },
                ]
          }
        />
      </div>
    );
  }

  return (
    <div className="manage-dashboard">
      {!isAdmin ? (
        <ManageActiveXNotice
          userId={user.id}
          activeXUserId={user.active_x_user_id}
        />
      ) : null}
      <ManagePageHeader
        title="イベント運営"
        description="あなたが担当するイベントの状態・審査待ち・関連履歴を表示します。"
        accent
      >
        <Link href="/manage/notifications" className="fn-btn fn-btn-ghost fn-btn-sm">
          <Icon name="alert" size={11} aria-hidden /> 通知センター
        </Link>
        {canManageXLinks ? (
          <Link href="/manage/x-link-requests" className="fn-btn fn-btn-ghost fn-btn-sm">
            <Icon name="user" size={11} aria-hidden /> X ID 連携申請
          </Link>
        ) : null}
      </ManagePageHeader>

      <section className="manage-dashboard-summary" aria-labelledby="manage-summary-title">
        <div className="manage-dashboard-summary-copy">
          <p className="manage-dashboard-eyebrow">OPERATIONS OVERVIEW</p>
          <h2 id="manage-summary-title">運営の全体像</h2>
          <p>担当イベントの状態をひと目で確認し、必要な作業へ移動できます。</p>
        </div>
        <div className="manage-dashboard-kpi-grid">
          <div className="manage-dashboard-kpi">
            <span>担当イベント</span>
            <strong>{eventRows.length.toLocaleString()}</strong>
          </div>
          <div
            className={`manage-dashboard-kpi ${pendingReviewTotal > 0 ? "manage-dashboard-kpi--warn" : ""}`}
          >
            <span>審査待ち</span>
            <strong>{pendingReviewTotal.toLocaleString()}</strong>
          </div>
          <div className="manage-dashboard-kpi">
            <span>受付中</span>
            <strong>{acceptingEventCount.toLocaleString()}</strong>
          </div>
          <div
            className={`manage-dashboard-kpi ${failedCount > 0 ? "manage-dashboard-kpi--danger" : ""}`}
          >
            <span>通知失敗</span>
            <strong>{failedCount.toLocaleString()}</strong>
          </div>
        </div>
      </section>

      {failedCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger">
          <strong>担当イベントに失敗通知が {failedCount} 件</strong>
          {" "}あります。{" "}
          <Link href="/manage/notifications?status=failed">通知センターで確認 →</Link>
        </div>
      ) : null}

      {eventNotificationSchemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn">
          イベント通知の絞り込みに必要な DB migration が未適用です。
          ローカルでは `npm.cmd run db:local-apply` を実行してください。
        </div>
      ) : null}

      <section className="fn-console-section fn-console-section--tight">
        <h2 className="fn-console-eyebrow">運営状況一覧</h2>
        <div className="fn-console-stack">
          {eventRows.map((ev) => {
            const status = computeEventStatus(ev);
            const pending = pendingByEvent.get(ev.id) ?? 0;
            const eventHrefId = encodeURIComponent(ev.id);
            const staffRole = isAdmin
              ? null
              : staffRoleByEvent.get(ev.id) ?? null;
            return (
              <article
                key={ev.id}
                className="manage-event-card manage-event-status-card"
                style={manageEventAccentStyle(ev.accent_color)}
              >
                <div className="fn-console-event-body">
                  <div className="fn-console-event-title-row">
                    <Link href={`/manage/events/${eventHrefId}`}>
                      {ev.title}
                    </Link>
                    <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
                      {eventStatusLabel(status)}
                    </span>
                    {!isAdmin ? (
                      <span className="fn-badge fn-badge-soft">
                        {staffRole === "representative" ? "代表" : "運営"}
                      </span>
                    ) : null}
                    {pending > 0 ? (
                      <span className="fn-badge fn-badge-warning">
                        審査待ち {pending}
                      </span>
                    ) : null}
                  </div>
                  <div className="fn-console-event-meta manage-event-status-meta">
                    <span>
                      {ev.start_time ? formatUnix(ev.start_time, { dateOnly: true }) : "—"}
                      {ev.end_time
                        ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                        : ""}
                    </span>
                    {pending > 0 ? (
                      <span className="manage-event-status-pending">
                        審査待ち作品 {pending} 件
                      </span>
                    ) : (
                      <span className="manage-event-status-ok">審査待ちなし</span>
                    )}
                  </div>
                </div>
                <div className="manage-actions">
                  <Link
                    href={`/manage/events/${eventHrefId}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    運営トップ
                  </Link>
                  <Link
                    href={`/manage/events/${eventHrefId}/videos?status=pending`}
                    className={`fn-btn fn-btn-sm ${
                      pending > 0 ? "fn-btn-primary" : "fn-btn-ghost"
                    }`}
                  >
                    <Icon name="check" size={12} aria-hidden />
                    {pending > 0 ? `審査 (${pending})` : "審査"}
                  </Link>
                  <Link
                    href={`/manage/events/${eventHrefId}/slots`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    枠
                  </Link>
                  <Link
                    href={`/event/${eventHrefId}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    公開ページ
                  </Link>
                  {isAdmin ? (
                    <Link
                      href={`/manage/events/${eventHrefId}/edit`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      <Icon name="settings" size={12} aria-hidden /> 設定
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {eventNotifications.length > 0 ? (
        <section className="fn-console-section">
          <h2 className="fn-console-eyebrow">イベント通知（直近）</h2>
          <FnTable className="manage-event-notifications-table">
            <thead>
              <tr>
                <th>通知</th>
                <th className="manage-notification-th-date">日時</th>
                <th className="manage-notification-th-event">イベント</th>
              </tr>
            </thead>
            <tbody>
              {eventNotifications.map((n) => {
                const ev = eventRows.find((e) => e.id === n.event_id);
                return (
                  <tr key={n.id}>
                    <td>
                      <NotificationOutboxSummary row={n} />
                    </td>
                    <td className="fn-td-nowrap">
                      <div>{formatUnix(n.created_at)}</div>
                      <div className="fn-td-muted">{formatRelative(n.created_at)}</div>
                    </td>
                    <td className="manage-notification-event-cell">
                      {ev ? (
                        <Link href={`/manage/events/${encodeURIComponent(ev.id)}`}>
                          {ev.title}
                        </Link>
                      ) : n.event_id ? (
                        <span className="fn-td-mono">{n.event_id.slice(0, 8)}…</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </FnTable>
        </section>
      ) : null}

      <section className="fn-console-section">
        <h2 className="fn-console-eyebrow">受信箱 (担当イベント関連の更新履歴)</h2>
        {recentInbox.length === 0 ? (
          <EmptyState
            tone="success"
            title="直近の更新はありません"
            description="担当イベントに関する履歴更新は、ここに表示されます。問題がなければこのままで大丈夫です。"
            iconName="check"
            actions={[
              {
                href: "/manage",
                label: "イベント運営トップへ",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <FnTable>
            <thead>
              <tr>
                <th>日時</th>
                <th>イベント</th>
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {recentInbox.map((h) => {
                const ev = eventRows.find((e) => e.id === h.target_id);
                return (
                  <tr key={h.id}>
                    <td className="fn-td-nowrap">
                      <div>{formatUnix(h.created_at)}</div>
                      <div className="fn-td-muted">{formatRelative(h.created_at)}</div>
                    </td>
                    <td>
                      {ev ? (
                        <Link href={`/event/${ev.id}`}>{ev.title}</Link>
                      ) : (
                        <span className="fn-td-mono">{h.target_id}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`fn-badge ${
                          h.operation === "DELETE"
                            ? "fn-badge-danger"
                            : h.operation === "CREATE"
                              ? "fn-badge-accent"
                              : "fn-badge-soft"
                        }`}
                      >
                        {h.operation}
                      </span>
                    </td>
                    <td className="fn-td-muted">{h.actor_user_id ?? "-"}</td>
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
