import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEventFromSnapshot,
  getManageStaffRoleFromSnapshot,
  getManageStaffXUserIdsFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import { getManageEventForRender } from "@/lib/manage/manageEventRender";
import {
  auditLogs as auditLogsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
} from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { drizzleManageNotificationFilter } from "@/lib/notifications/display";
import {
  categorizeNotificationType,
  MANAGE_NOTIFICATION_FILTER_OPTIONS,
  type ManageNotificationFilter,
} from "@/lib/notifications/types";
import { NotificationOutboxSummary } from "@/components/notifications/NotificationOutboxSummary";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { Icon } from "@/components/ui/Icon";
import { SaveEventTemplateForm } from "@/components/admin/SaveEventTemplateForm";
import {
  lookupNotificationRecipients,
  type RecipientLookup,
} from "@/lib/notifications/recipient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notif?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const event = await getManageEventForRender(id);
    return event?.title
      ? { title: `${event.title} 運営` }
      : { title: "イベント運営" };
  } catch {
    return { title: id };
  }
}

export default async function ManageEventPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const notifCategory: ManageNotificationFilter =
    sp.notif === "video" ||
    sp.notif === "x_id" ||
    sp.notif === "slot" ||
    sp.notif === "chapter" ||
    sp.notif === "other"
      ? sp.notif
      : "all";
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const isAdmin = user.role === "admin";
  const authorization = await getManageAuthorizationSnapshot(
    user.id,
    user.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(user.id, user.role ?? null);
  if (!canAccessManageEventFromSnapshot(authorization, id)) notFound();
  // The navigation snapshot already contains every display field used by
  // this overview. Avoid a second full events-row read after the sidebar.
  const ev = navigation.events.find((event) => event.id === id);
  if (!ev) notFound();

  const editorRole = isAdmin
    ? null
    : getManageStaffRoleFromSnapshot(authorization, id);
  const pendingTotal = navigation.pendingByEvent.get(id) ?? 0;

  const [publicCount, slotCounts] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.visibility_status, "public"),
        )!,
      ),
    db
      .select({
        status: slotsTable.status,
        c: sql<number>`COUNT(*)`,
      })
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .groupBy(slotsTable.status),
  ]);

  const slotStatusMap: Record<string, number> = {};
  for (const r of slotCounts) {
    slotStatusMap[r.status] = Number(r.c ?? 0);
  }
  const totalSlots = Object.values(slotStatusMap).reduce((a, b) => a + b, 0);
  const filledSlots = Math.max(0, totalSlots - (slotStatusMap.available ?? 0));
  const reservedSlots = slotStatusMap.reserved ?? 0;
  const submittedSlots = slotStatusMap.submitted ?? 0;
  const publicTotal = Number(publicCount[0]?.c ?? 0);
  const slotFillPct =
    totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  const pendingVideos = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      display_name: videosTable.creator_display_name,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .where(
      and(
        eq(videoEventsTable.event_id, id),
        eq(videosTable.visibility_status, "pending"),
      )!,
    )
    .orderBy(desc(videosTable.created_at))
    .limit(10);

  const eventAuditLogs = await db
    .select()
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.table_name, "events"),
        eq(auditLogsTable.target_id, id),
      )!,
    )
    .orderBy(desc(auditLogsTable.created_at))
    .limit(15);

  const categoryWhere = (cat: ManageNotificationFilter) => {
    if (cat === "all") return eq(notificationOutboxTable.event_id, id);
    return and(
      eq(notificationOutboxTable.event_id, id),
      drizzleManageNotificationFilter(cat, notificationOutboxTable.type),
    )!;
  };

  const notifCounts: Record<ManageNotificationFilter, number> = {
    all: 0,
    video: 0,
    x_id: 0,
    slot: 0,
    chapter: 0,
    other: 0,
  };
  let eventNotifications: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let eventNotificationSchemaMissing = false;
  try {
    const typeCountRows = await db
      .select({
        type: notificationOutboxTable.type,
        c: sql<number>`COUNT(*)`,
      })
      .from(notificationOutboxTable)
      .where(eq(notificationOutboxTable.event_id, id))
      .groupBy(notificationOutboxTable.type);
    for (const r of typeCountRows) {
      const c = Number(r.c ?? 0);
      notifCounts.all += c;
      const bucket = categorizeNotificationType(r.type);
      if (bucket === "video") notifCounts.video += c;
      else if (bucket === "x_id") notifCounts.x_id += c;
      else if (bucket === "slot") notifCounts.slot += c;
      else if (bucket === "chapter") notifCounts.chapter += c;
      else notifCounts.other += c;
    }

    eventNotifications = await db
      .select()
      .from(notificationOutboxTable)
      .where(categoryWhere(notifCategory))
      .orderBy(desc(notificationOutboxTable.created_at))
      .limit(20);
  } catch (e) {
    eventNotificationSchemaMissing = true;
    console.warn("[ManageEventPage] notification_outbox.event_id unavailable", e);
  }

  const showEventNotificationsSection =
    !eventNotificationSchemaMissing && notifCounts.all > 0;

  let recipientMap = new Map<string, RecipientLookup>();
  if (eventNotifications.length > 0) {
    recipientMap = await lookupNotificationRecipients(
      db,
      eventNotifications
        .map((n) => n.recipient_user_id)
        .filter((id): id is string => Boolean(id)),
    );
  }

  const status = computeEventStatus(ev);
  const accepting = isAcceptingEntries(ev);
  const eventHrefId = encodeURIComponent(id);

  const eventDateLead = (
    <>
      {ev.start_time ? formatUnix(ev.start_time, { dateOnly: true }) : "—"}
      {ev.end_time ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}` : ""}
      {ev.entry_start_time != null || ev.entry_end_time != null ? (
        <span className="fn-console-meta-sep">
          · 募集{" "}
          {ev.entry_start_time != null ? formatUnix(ev.entry_start_time) : "—"}
          {" 〜 "}
          {ev.entry_end_time != null ? formatUnix(ev.entry_end_time) : "—"}
        </span>
      ) : null}
    </>
  );

  return (
    <ManageEventPageShell
      eventId={id}
      title={ev.title}
      description={eventDateLead}
      backHref="/manage"
      backLabel="担当イベント一覧へ"
      isAdmin={isAdmin}
      pendingCount={pendingTotal}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
      showActiveXNotice
      activeXUserId={user.active_x_user_id}
      manageStaffXUserIds={getManageStaffXUserIdsFromSnapshot(authorization)}
      headerChildren={
        <>
          <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
            {eventStatusLabel(status)}
          </span>
          {accepting ? (
            <span className="fn-badge fn-badge-soft">受付中</span>
          ) : null}
          <span className="fn-badge fn-badge-soft">
            {isAdmin
              ? "管理者"
              : editorRole === "representative"
                ? "代表"
                : "運営"}
          </span>
        </>
      }
    >
      <div className="manage-event-overview-grid">
        <section
          className={`manage-section manage-attention ${
            pendingTotal > 0 ? "manage-attention--warn" : "manage-attention--ok"
          }`}
        >
          <div>
            <h2 className="manage-attention-title">
              {pendingTotal > 0
                ? "対応が必要です"
                : "現在、対応が必要な作品はありません"}
            </h2>
            <p className="manage-attention-lead">
              {pendingTotal > 0
                ? `審査待ち ${pendingTotal.toLocaleString()} 件があります。`
                : "審査待ちの作品はありません。進行状況を確認できます。"}
            </p>
          </div>
          {pendingTotal > 0 ? (
            <Link
              href={`/manage/events/${eventHrefId}/videos?status=pending`}
              className="fn-btn fn-btn-primary fn-btn-sm"
            >
              審査を開始
            </Link>
          ) : null}
        </section>

        <section className="manage-section manage-progress">
          <div className="manage-progress-head">
            <h2 className="manage-progress-label">進行状況</h2>
            <span className="manage-progress-value">
              公開作品 {publicTotal.toLocaleString()} 件
            </span>
          </div>
          <div>
            <div className="manage-progress-head manage-progress-head--compact">
              <span className="manage-progress-label">枠の埋まり</span>
              <span className="manage-progress-value">
                {filledSlots.toLocaleString()} / {totalSlots.toLocaleString()}
              </span>
            </div>
            <div
              className="manage-progress-bar"
              role="progressbar"
              aria-valuenow={slotFillPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="枠の埋まり率"
            >
              <div
                className="manage-progress-bar-fill"
                style={{ width: `${slotFillPct}%` }}
              />
            </div>
          </div>
          <div className="manage-progress-stats">
            <span>
              確保済 <strong>{reservedSlots.toLocaleString()}</strong>
            </span>
            <span>
              提出済 <strong>{submittedSlots.toLocaleString()}</strong>
            </span>
          </div>
        </section>
      </div>

      <nav
        className="manage-event-action-rail"
        aria-label="イベント運営ショートカット"
      >
        <Link
          href={`/manage/events/${eventHrefId}/videos?status=pending`}
          className={`manage-event-action-card ${
            pendingTotal > 0 ? "manage-event-action-card--priority" : ""
          }`}
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="check" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">審査キュー</span>
            <span className="manage-event-action-meta">
              {pendingTotal > 0
                ? `${pendingTotal.toLocaleString()} 件を確認`
                : "対応待ちはありません"}
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/videos?status=all`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="list" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">作品を管理</span>
            <span className="manage-event-action-meta">
              公開中 {publicTotal.toLocaleString()} 件
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/slots`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="calendar" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">予約枠を確認</span>
            <span className="manage-event-action-meta">
              {totalSlots > 0
                ? `埋まり率 ${slotFillPct}%`
                : "予約枠が未設定です"}
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/audience`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="users" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">参加者を確認</span>
            <span className="manage-event-action-meta">参加状況を確認</span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/edit#section-required`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="settings" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">投稿の必須項目</span>
            <span className="manage-event-action-meta">作品フォームの必須設定</span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>
      </nav>

      {isAdmin ? (
        <section className="fn-console-section">
          <h2 className="fn-console-eyebrow">テンプレート化</h2>
          <div className="fn-card manage-template-card">
            <SaveEventTemplateForm eventId={ev.id} eventTitle={ev.title} />
          </div>
        </section>
      ) : null}

      {eventNotificationSchemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn fn-console-section--tight">
          イベント通知の絞り込みに必要な DB migration が未適用です。
          ローカルでは `npm.cmd run db:local-apply` を実行してください。
        </div>
      ) : null}

      <section className="manage-section manage-event-pending-section">
        <h2 className="fn-console-eyebrow">直近の審査待ち</h2>
        {pendingVideos.length === 0 ? (
          <EmptyState
            tone="success"
            title="審査待ちはありません"
            description="現在、このイベントで対応が必要な作品はありません。"
            iconName="check"
            actions={[
              { href: `/event/${eventHrefId}`, label: "公開ページを見る", variant: "primary" },
              {
                href: `/manage/events/${eventHrefId}/slots`,
                label: "枠を見る",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <FnTable className="manage-event-pending-table">
            <thead>
              <tr>
                <th className="manage-event-pending-title-col">タイトル</th>
                <th className="manage-event-pending-author-col">作者</th>
                <th className="manage-event-pending-date-col">登録</th>
                <th className="manage-event-pending-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {pendingVideos.map((v, index) => (
                <tr key={`${v.id}-pending-${index}`}>
                  <td className="manage-event-pending-title-cell">{v.title}</td>
                  <td className="manage-event-pending-author-cell">{v.display_name}</td>
                  <td className="manage-event-pending-date-cell fn-muted">
                    {formatRelative(v.created_at)}
                  </td>
                  <td className="manage-event-pending-actions-cell">
                    <div className="fn-console-row-actions">
                      <Link
                        href={`/manage/events/${eventHrefId}/videos/${v.id}`}
                        className="fn-btn fn-btn-primary fn-btn-sm"
                      >
                        審査
                      </Link>
                      <Link
                        href={`/dashboard/edit/${v.id}?privileged=event`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                      >
                        内容確認
                      </Link>
                      {isAdmin ? (
                        <Link
                          href={`/admin/videos/${v.id}`}
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                        >
                          管理者用
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>

      {showEventNotificationsSection ? (
        <details className="manage-collapsible">
          <summary>
            イベント通知
            <span className="fn-muted fn-text-sm">
              {notifCounts.all.toLocaleString()} 件
            </span>
          </summary>
          <div className="manage-collapsible-body">
            <p className="fn-muted fn-text-sm fn-console-block-lead">
              このイベントに紐づく Discord 通知の配信状況です。
            </p>
            <nav
              aria-label="通知カテゴリフィルタ"
              className="manage-filter-compact"
            >
              {MANAGE_NOTIFICATION_FILTER_OPTIONS.map(({ key, label }) => {
                const href =
                  key === "all"
                    ? `/manage/events/${eventHrefId}`
                    : `/manage/events/${eventHrefId}?notif=${key}`;
                return (
                  <Link
                    key={key}
                    href={href}
                    aria-current={notifCategory === key ? "page" : undefined}
                  >
                    {label} ({notifCounts[key]})
                  </Link>
                );
              })}
            </nav>
            {eventNotifications.length === 0 ? (
              <EmptyState
                tone="neutral"
                title="該当する通知はありません"
                description="選択中のカテゴリに一致する通知ログはありません。"
                actions={[
                  {
                    href: `/manage/events/${eventHrefId}`,
                    label: "すべての通知を見る",
                    variant: "ghost",
                  },
                ]}
              />
            ) : (
              <FnTable>
                <thead>
                  <tr>
                    <th className="fn-th-w140">日時</th>
                    <th>通知</th>
                    <th className="fn-th-w56">試行</th>
                  </tr>
                </thead>
                <tbody>
                  {eventNotifications.map((n) => (
                    <tr key={n.id}>
                      <td className="fn-td-nowrap fn-td-top">
                        <div>{formatUnix(n.created_at)}</div>
                        <div className="fn-td-muted">
                          {formatRelative(n.created_at)}
                        </div>
                      </td>
                      <td>
                        <NotificationOutboxSummary
                          row={n}
                          recipient={
                            (n.recipient_user_id
                              ? recipientMap.get(n.recipient_user_id) ?? null
                              : null)
                          }
                        />
                      </td>
                      <td className="fn-td-tabular">{n.attempt_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </FnTable>
            )}
          </div>
        </details>
      ) : null}

      <details className="manage-collapsible">
        <summary>
          イベント更新履歴
          <span className="fn-muted fn-text-sm">
            {eventAuditLogs.length.toLocaleString()} 件
          </span>
        </summary>
        <div className="manage-collapsible-body">
          {eventAuditLogs.length === 0 ? (
            <EmptyState
              tone="success"
              title="直近の更新はありません"
              description="このイベントに関する操作履歴は、ここに表示されます。"
              iconName="check"
            />
          ) : (
            <FnTable>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作</th>
                  <th>実行者</th>
                </tr>
              </thead>
              <tbody>
                {eventAuditLogs.map((h) => (
                  <tr key={h.id}>
                    <td className="fn-td-nowrap">
                      <div>{formatUnix(h.created_at)}</div>
                      <div className="fn-td-muted">{formatRelative(h.created_at)}</div>
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
                    <td className="fn-td-secondary">
                      {h.actor_user_id ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FnTable>
          )}
        </div>
      </details>
    </ManageEventPageShell>
  );
}
