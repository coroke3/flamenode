import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEvent,
  getManageStaffRoleForEvent,
} from "@/lib/auth/ownership";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import {
  events as eventsTable,
  historyLogs as historyLogsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
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
import { ManagePageHeader } from "@/components/manage/ManagePageHeader";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
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
  const db = getDatabase();
  if (!db) return { title: id };
  try {
    const ev = await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return ev[0]?.title
      ? { title: `${ev[0].title} 運営` }
      : { title: "イベント運営" };
  } catch {
    // Miniflare D1 が稀に transient エラーを返すため metadata で 500 を出さない
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

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const isAdmin = user.role === "admin";
  const canAccess = await canAccessManageEvent(db, user, id);
  if (!canAccess) notFound();

  const editorRole = isAdmin
    ? null
    : await getManageStaffRoleForEvent(db, user.id, id);

  // 集計
  const [pendingCount, publicCount, slotCounts] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.visibility_status, "pending"),
        )!,
      ),
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

  // 直近の審査待ち作品
  const pendingVideos = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
    .where(
      and(
        eq(videoEventsTable.event_id, id),
        eq(videosTable.visibility_status, "pending"),
      )!,
    )
    .orderBy(desc(videosTable.created_at))
    .limit(10);

  // 当該イベントの直近 history_logs (events / video_events / slots すべて)
  const historyEv = await db
    .select()
    .from(historyLogsTable)
    .where(
      and(
        eq(historyLogsTable.table_name, "events"),
        eq(historyLogsTable.record_id, id),
      )!,
    )
    .orderBy(desc(historyLogsTable.created_at))
    .limit(15);

  // event-scoped 通知: カテゴリ別件数は DB の GROUP BY で集計し、
  // 一覧は対象カテゴリだけ where 句で絞り込んで取得する (クライアントフィルタを廃止)。
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
    // カテゴリ別件数集計 (GROUP BY で 1 クエリ)
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
      eventNotifications.map((n) => n.discord_user_id),
    );
  }

  const status = computeEventStatus(ev);
  const accepting = isAcceptingEntries(ev);

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
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <ManageActiveXNotice
        userId={user.id}
        activeXUserId={user.active_x_user_id}
      />
      <ManagePageHeader
        title={ev.title}
        description={eventDateLead}
        backHref="/manage"
        backLabel="担当イベント一覧へ"
        accent
      >
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
      </ManagePageHeader>

      <section className="fn-console-stat-grid">
        <Stat label="審査待ち" value={Number(pendingCount[0]?.c ?? 0)} accent />
        <Stat label="公開済み" value={Number(publicCount[0]?.c ?? 0)} />
        <Stat label="枠合計" value={totalSlots} />
        <Stat label="埋まり枠" value={filledSlots} />
        <Stat label="確保済" value={reservedSlots} />
        <Stat label="提出済" value={submittedSlots} />
      </section>

      <ManageEventTabs eventId={id} active="overview" isAdmin={isAdmin} />

      {eventNotificationSchemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn fn-console-section--tight">
          イベント通知の絞り込みに必要な DB migration が未適用です。
          ローカルでは `npm.cmd run db:local-apply` を実行してください。
        </div>
      ) : null}

      <section className="fn-console-section">
        <h2 className="fn-console-eyebrow">直近の審査待ち作品</h2>
        {pendingVideos.length === 0 ? (
          <EmptyState
            tone="success"
            title="審査待ちはありません"
            description="現在、このイベントで対応が必要な作品はありません。"
            iconName="check"
            actions={[
              { href: `/event/${id}`, label: "公開ページを見る", variant: "primary" },
              {
                href: `/manage/events/${id}/slots`,
                label: "枠を見る",
                variant: "ghost",
              },
              {
                href: `/manage/events/${id}`,
                label: "イベント運営トップへ",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <FnTable>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>作者</th>
                <th>登録</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingVideos.map((v, index) => (
                <tr key={`${v.id}-pending-${index}`}>
                  <td>{v.title}</td>
                  <td>{v.display_name}</td>
                  <td className="fn-muted">{formatRelative(v.created_at)}</td>
                  <td>
                    <div className="fn-console-row-actions">
                      <Link
                        href={`/manage/events/${id}/videos/${v.id}`}
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
        <section className="fn-console-section">
          <h2 className="fn-console-eyebrow">イベント通知</h2>
          <p className="fn-muted fn-text-sm fn-console-block-lead">
            このイベントに紐づく Discord 通知の配信状況です。失敗時は内容と次の操作を確認してください。
          </p>
          <nav
            aria-label="通知カテゴリフィルタ"
            className="fn-console-filter-nav"
          >
            {MANAGE_NOTIFICATION_FILTER_OPTIONS.map(({ key, label }) => {
              const href =
                key === "all"
                  ? `/manage/events/${id}`
                  : `/manage/events/${id}?notif=${key}`;
              return (
                <Link
                  key={key}
                  href={href}
                  className={`fn-btn fn-btn-sm ${notifCategory === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
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
              description="選択中のカテゴリに一致する通知ログはありません。フィルタを変えるか、しばらくしてから再度確認してください。"
              actions={[
                {
                  href: `/manage/events/${id}`,
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
                          recipientMap.get(n.discord_user_id) ?? null
                        }
                      />
                    </td>
                    <td className="fn-td-tabular">{n.attempt_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </FnTable>
          )}
        </section>
      ) : null}

      <section className="fn-console-section">
        <h2 className="fn-console-eyebrow">イベント更新履歴</h2>
        {historyEv.length === 0 ? (
          <EmptyState
            tone="success"
            title="直近の更新はありません"
            description="このイベントに関する操作履歴は、ここに表示されます。"
            iconName="check"
            actions={[
              {
                href: `/manage/events/${id}`,
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
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {historyEv.map((h) => (
                <tr key={h.id}>
                  <td className="fn-td-nowrap">
                    <div>{formatUnix(h.created_at)}</div>
                    <div className="fn-td-muted">{formatRelative(h.created_at)}</div>
                  </td>
                  <td>
                    <span
                      className={`fn-badge ${
                        h.action === "DELETE"
                          ? "fn-badge-danger"
                          : h.action === "CREATE"
                            ? "fn-badge-accent"
                            : "fn-badge-soft"
                      }`}
                    >
                      {h.action}
                    </span>
                  </td>
                  <td className="fn-td-secondary">
                    {h.operator_discord_id ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`fn-card fn-console-stat ${accent && value > 0 ? "fn-card-accent" : ""}`}
    >
      <div className="fn-console-stat-label">{label}</div>
      <div className="fn-console-stat-value">{value.toLocaleString()}</div>
    </div>
  );
}
