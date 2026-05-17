import * as React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  events as eventsTable,
  eventEditors as eventEditorsTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";

/**
 * /manage 配下のクイックナビ。担当イベント一覧を左サイドに表示する。
 * 該当イベントが無い (運営者でない) 場合は何も描画しない。
 */
export async function ManageSidebar(): Promise<React.ReactElement | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const db = getDatabase();
  if (!db) return null;
  const activeX = u.active_x_user_id;
  if (!activeX) return null;

  const editorRows = await db
    .select({ event_id: eventEditorsTable.event_id })
    .from(eventEditorsTable)
    .where(eq(eventEditorsTable.x_user_id, activeX));
  const eventIds = editorRows.map((r) => r.event_id);
  if (eventIds.length === 0) return null;

  const events = await db
    .select({ id: eventsTable.id, title: eventsTable.title })
    .from(eventsTable)
    .where(inArray(eventsTable.id, eventIds));

  return (
    <aside
      style={{
        width: 220,
        minWidth: 200,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "12px 10px",
        alignSelf: "flex-start",
        position: "sticky",
        top: 76,
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.16em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          marginBottom: 8,
          padding: "0 4px",
        }}
      >
        MANAGE
      </p>
      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Link
          href="/manage"
          style={{
            padding: "6px 8px",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-primary)",
            textDecoration: "none",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="grid" size={11} aria-hidden /> トップ
        </Link>
        {events.map((ev) => (
          <Link
            key={ev.id}
            href={`/manage/events/${ev.id}`}
            style={{
              padding: "6px 8px",
              fontSize: 12,
              color: "var(--text-secondary)",
              textDecoration: "none",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {ev.title}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
