import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

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
import { ManagePageHeader } from "@/components/manage/ManagePageHeader";

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

  let eventIds = eventFilter ? [eventFilter] : managedEvents.map((e) => e.id);
  if (eventFilter) {
    if (!editableIds.includes(eventFilter)) {
      const ok = await canAccessManageEvent(db, user, eventFilter);
      if (!ok) notFound();
    }
    eventIds = [eventFilter];
  }

  let rows: (typeof notificationOutboxTable.$inferSelect)[] = [];
  let schemaMissing = false;

  if (eventIds.length > 0) {
    try {
      const conds = [inArray(notificationOutboxTable.event_id, eventIds)];
      if (notifFilter !== "all") {
        conds.push(
          drizzleManageNotificationFilter(
            notifFilter,
            notificationOutboxTable.type,
          ),
        );
      }
      if (
        statusFilter === "pending" ||
        statusFilter === "processing" ||
        statusFilter === "sent" ||
        statusFilter === "failed" ||
        statusFilter === "cancelled"
      ) {
        conds.push(eq(notificationOutboxTable.status, statusFilter));
      }
      rows = await db
        .select()
        .from(notificationOutboxTable)
        .where(and(...conds)!)
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
      rows.map((r) => r.recipient_user_id),
    );
  }

  const failedCount = rows.filter((r) => r.status === "failed").length;
  const eventTitleById = new Map(managedEvents.map((e) => [e.id, e.title]));

  return (
    <div>
      <ManageActiveXNotice
        userId={user.id}
        activeXUserId={user.active_x_user_id}
      />
      <ManagePageHeader
        title="通知センター"
        description="担当イベントに紐づく Discord 通知の配信状況です（直近 50 件）。復旧操作は管理者が /admin/notifications で行います。"
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
          <strong>配信失敗 {failedCount} 件</strong> — 内容と次の操作を各行で確認してください。
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
        <AutoSubmitSelect name="event" defaultValue={eventFilter} className="fn-input fn-input-sm">
          <option value="">すべての担当イベント</option>
          {managedEvents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="notif" defaultValue={notifFilter} className="fn-input fn-input-sm">
          {MANAGE_NOTIFICATION_FILTER_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="status" defaultValue={statusFilter} className="fn-input fn-input-sm">
          <option value="">すべての状態</option>
          <option value="pending">配信待ち</option>
          <option value="processing">送信中</option>
          <option value="sent">送信済み</option>
          <option value="failed">失敗</option>
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
            {rows.map((n) => (
              <tr key={n.id}>
                <td style={{ verticalAlign: "top" }}>
                  <div>{formatUnix(n.created_at)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {formatRelative(n.created_at)}
                  </div>
                </td>
                <td>
                  <NotificationOutboxSummary
                    row={n}
                    recipient={recipientMap.get(n.recipient_user_id) ?? null}
                  />
                </td>
                <td style={{ verticalAlign: "top", fontSize: 12 }}>
                  {n.event_id ? (
                    <Link href={`/manage/events/${n.event_id}`}>
                      {eventTitleById.get(n.event_id)?.slice(0, 20) ??
                        `${n.event_id.slice(0, 8)}…`}
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
