import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import { canAccessManageEvent, getEditableEventIds } from "@/lib/auth/ownership";
import {
  events as eventsTable,
  notificationOutbox as notificationOutboxTable,
} from "@/lib/db/schema";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import { NotificationOutboxSummary } from "@/components/notifications/NotificationOutboxSummary";
import { drizzleManageNotificationFilter } from "@/lib/notifications/display";
import {
  isTerminalNotificationFailure,
  TERMINAL_NOTIFICATION_FAILURE_STATUSES,
} from "@/lib/notifications/status";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import {
  lookupNotificationRecipients,
  type RecipientLookup,
} from "@/lib/notifications/recipient";
import {
  MANAGE_NOTIFICATION_FILTER_OPTIONS,
  type ManageNotificationFilter,
} from "@/lib/notifications/types";
import { formatRelative, formatUnix } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { FnTable } from "@/components/ui/FnTable";
import { ConsolePageHeader as ManagePageHeader } from "@/components/layout/ConsolePageHeader";

export const metadata: Metadata = { title: "通知センター" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{
    event?: string;
    notif?: string;
    status?: string;
  }>;
}

export default async function ManageNotificationsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/manage/notifications" });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const sp = (await searchParams) ?? {};
  const eventFilter = (sp.event ?? "").trim();
  const notifFilter: ManageNotificationFilter =
    sp.notif === "video" ||
    sp.notif === "x_id" ||
    sp.notif === "slot" ||
    sp.notif === "chapter" ||
    sp.notif === "other"
      ? sp.notif
      : "all";
  const statusFilter = (sp.status ?? "").trim();

  const db = getDatabase();
  if (!db) notFound();

  const isAdmin = user.role === "admin";
  const editableIds = await getEditableEventIds(db, user.id);
  const managedEvents =
    editableIds.length > 0
      ? await db
          .select({ id: eventsTable.id, title: eventsTable.title })
          .from(eventsTable)
          .where(inArray(eventsTable.id, editableIds))
      : [];

  let eventIds = eventFilter ? [eventFilter] : managedEvents.map((event) => event.id);
  if (eventFilter) {
    if (!editableIds.includes(eventFilter)) {
      const allowed = await canAccessManageEvent(db, user, eventFilter);
      if (!allowed) notFound();
    }
    eventIds = [eventFilter];
  }

  let rows: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let schemaMissing = false;

  if (eventIds.length > 0) {
    try {
      const conditions = [inArray(notificationOutboxTable.event_id, eventIds)];
      if (notifFilter !== "all") {
        conditions.push(
          drizzleManageNotificationFilter(
            notifFilter,
            notificationOutboxTable.type,
          ),
        );
      }
      if (statusFilter === "failed") {
        conditions.push(
          inArray(notificationOutboxTable.status, [
            ...TERMINAL_NOTIFICATION_FAILURE_STATUSES,
          ]),
        );
      } else if (
        statusFilter === "pending" ||
        statusFilter === "processing" ||
        statusFilter === "sent" ||
        statusFilter === "cancelled"
      ) {
        conditions.push(eq(notificationOutboxTable.status, statusFilter));
      }
      rows = await db
        .select()
        .from(notificationOutboxTable)
        .where(and(...conditions)!)
        .orderBy(desc(notificationOutboxTable.created_at))
        .limit(50);
    } catch {
      schemaMissing = true;
    }
  }

  let recipientMap = new Map<string, RecipientLookup>();
  if (rows.length > 0) {
    recipientMap = await lookupNotificationRecipients(
      db,
      rows.map((row) => row.recipient_user_id),
    );
  }

  const failedCount = rows.filter((row) =>
    isTerminalNotificationFailure(row.status),
  ).length;
  const eventTitleById = new Map(
    managedEvents.map((event) => [event.id, event.title]),
  );

  return (
    <div>
      <ManageActiveXNotice
        userId={user.id}
        activeXUserId={user.active_x_user_id}
      />
      <ManagePageHeader
        title="通知センター"
        description="担当イベントに紐づくDiscord通知の配信状況です（直近50件）。最終失敗の復旧操作はサイト管理者が行います。"
        backHref="/manage"
        backLabel="イベント運営トップへ"
      />

      {schemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn">
          notification_outbox の event_id 列が未適用です。{" "}
          <code>npm run db:local-apply</code> を実行してください。
        </div>
      ) : null}

      {failedCount > 0 ? (
        <div role="status" className="fn-alert fn-alert--danger">
          <strong>最終失敗 {failedCount} 件</strong>
          {" "}— 内容と案内を各行で確認してください。
          {isAdmin ? (
            <>
              {" "}
              <Link href="/admin/notifications?status=failed">管理者用ログ →</Link>
            </>
          ) : null}
        </div>
      ) : null}

      <form
        method="get"
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <AutoSubmitSelect
          name="event"
          defaultValue={eventFilter}
          className="fn-input fn-input-sm"
        >
          <option value="">すべての担当イベント</option>
          {managedEvents.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect
          name="notif"
          defaultValue={notifFilter}
          className="fn-input fn-input-sm"
        >
          {MANAGE_NOTIFICATION_FILTER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect
          name="status"
          defaultValue={statusFilter}
          className="fn-input fn-input-sm"
        >
          <option value="">すべての状態</option>
          <option value="pending">配信待ち</option>
          <option value="processing">送信中</option>
          <option value="sent">送信済み</option>
          <option value="failed">最終失敗</option>
          <option value="cancelled">キャンセル</option>
        </AutoSubmitSelect>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          tone="neutral"
          title="通知はありません"
          description="選択条件に一致する通知ログがありません。"
          actions={[{ href: "/manage", label: "運営トップへ", variant: "ghost" }]}
        />
      ) : (
        <FnTable>
          <thead>
            <tr>
              <th style={{ width: 130 }}>日時</th>
              <th>通知</th>
              <th style={{ width: 100 }}>イベント</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((notification) => (
              <tr key={notification.id}>
                <td style={{ verticalAlign: "top" }}>
                  <div>{formatUnix(notification.created_at)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {formatRelative(notification.created_at)}
                  </div>
                </td>
                <td>
                  <NotificationOutboxSummary
                    row={notification}
                    recipient={
                      recipientMap.get(notification.recipient_user_id) ?? null
                    }
                  />
                </td>
                <td style={{ verticalAlign: "top", fontSize: 12 }}>
                  {notification.event_id ? (
                    <Link href={`/manage/events/${notification.event_id}`}>
                      {eventTitleById.get(notification.event_id)?.slice(0, 20) ??
                        `${notification.event_id.slice(0, 8)}…`}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </FnTable>
      )}
    </div>
  );
}
