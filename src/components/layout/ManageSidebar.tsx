import * as React from "react";
import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getEditableEventIds,
  getManageStaffXUserIds,
  canManageXIdLinkRequests,
  shouldWarnManageActiveXMismatch,
} from "@/lib/auth/ownership";
import { events as eventsTable } from "@/lib/db/schema";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import { Icon } from "@/components/ui/Icon";
import styles from "./ManageSidebar.module.css";

/**
 * /manage 配下のクイックナビ。担当イベント一覧を左サイドに表示する。
 *
 * 担当判定は Active X ではなく getEditableEventIds（承認済み X ID 全体 + Discord）。
 */
export async function ManageSidebar(): Promise<React.ReactElement | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const db = getDatabase();
  if (!db) return null;

  const isAdmin = u.role === "admin";
  const editableEventIds = isAdmin ? [] : await getEditableEventIds(db, u.id);

  const events =
    isAdmin
      ? await db
          .select({
            id: eventsTable.id,
            title: eventsTable.title,
            accent_color: eventsTable.accent_color,
            is_active: eventsTable.is_active,
            is_archived: eventsTable.is_archived,
            start_time: eventsTable.start_time,
            end_time: eventsTable.end_time,
            entry_start_time: eventsTable.entry_start_time,
            entry_end_time: eventsTable.entry_end_time,
          })
          .from(eventsTable)
          .orderBy(
            desc(eventsTable.start_time),
            desc(eventsTable.created_at),
            desc(eventsTable.id),
          )
          .then((rows) => rows.sort(compareEventsByUpcomingPriority))
      : editableEventIds.length > 0
        ? await db
            .select({
              id: eventsTable.id,
              title: eventsTable.title,
              accent_color: eventsTable.accent_color,
              is_active: eventsTable.is_active,
              is_archived: eventsTable.is_archived,
              start_time: eventsTable.start_time,
              end_time: eventsTable.end_time,
              entry_start_time: eventsTable.entry_start_time,
              entry_end_time: eventsTable.entry_end_time,
            })
            .from(eventsTable)
            .where(inArray(eventsTable.id, editableEventIds))
            .orderBy(
              desc(eventsTable.start_time),
              desc(eventsTable.created_at),
              desc(eventsTable.id),
            )
            .then((rows) => rows.sort(compareEventsByUpcomingPriority))
        : [];

  const activeX = u.active_x_user_id?.trim() || null;
  const manageStaffXIds = isAdmin
    ? []
    : await getManageStaffXUserIds(
        db,
        u.id,
        events.map((event) => event.id),
      );
  const warnActiveX = !isAdmin && shouldWarnManageActiveXMismatch(activeX, manageStaffXIds);
  const canManageXLinks = await canManageXIdLinkRequests(db, {
    id: u.id,
    role: u.role ?? null,
  });

  return (
    <aside className={styles.sidebar}>
      <p className={styles.eyebrow}>MANAGE</p>
      {warnActiveX ? (
        <p className={styles.warn}>
          運営権限は承認済み X ID 全体で判定されます。投稿主体は Active X ID
          {activeX ? ` (@${activeX})` : "（未選択）"}
          です。
        </p>
      ) : null}
      <nav className={styles.nav} aria-label="イベント運営ナビ">
        <Link href="/manage" className={styles.topLink}>
          <Icon name="grid" size={11} aria-hidden /> 運営トップ
        </Link>
        {canManageXLinks ? (
          <Link href="/manage/x-link-requests" className={styles.topLink}>
            <Icon name="user" size={11} aria-hidden /> X ID 連携申請
          </Link>
        ) : null}
        {events.map((ev) => (
          <Link
            key={ev.id}
            href={`/manage/events/${ev.id}`}
            className={styles.eventLink}
            style={
              ev.accent_color
                ? ({ "--event-accent": ev.accent_color } as React.CSSProperties)
                : undefined
            }
            title={ev.title}
          >
            {ev.title}
          </Link>
        ))}
      </nav>
      {events.length === 0 ? (
        <p className={styles.emptyHint}>
          担当イベントが割り当てられると、ここに一覧が表示されます。
        </p>
      ) : null}
    </aside>
  );
}
