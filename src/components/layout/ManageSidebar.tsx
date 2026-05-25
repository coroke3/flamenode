import * as React from "react";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getEditableEventIds } from "@/lib/auth/ownership";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";

/**
 * /manage 配下のクイックナビ。担当イベント一覧を左サイドに表示する。
 *
 * 担当判定は user.active_x_user_id 単体ではなく、Discord ユーザーに紐づく
 * 承認済み X ID 全件 (`getApprovedXIds`) で `event_staff.x_user_id` を一致させる。
 *
 * これにより、運営権限を持つ X ID が active になっていない場合や、Discord に
 * 複数の運営 X ID が紐づいている場合でも、サイドバーで担当イベントを確認できる。
 * (旧コードは active X 不一致で空表示になり、ManageLayout が入場を許可しても
 *  サイドバーが空、という権限まわりの UX 不整合が起きていた)
 */
export async function ManageSidebar(): Promise<React.ReactElement | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const db = getDatabase();
  if (!db) return null;

  const eventIds = await getEditableEventIds(db, u.id);
  if (eventIds.length === 0) return null;

  const events = await db
    .select({ id: eventsTable.id, title: eventsTable.title })
    .from(eventsTable)
    .where(inArray(eventsTable.id, eventIds));

  // 運営権限のある X ID と現在の Active X ID がズレていないか確認する。
  // ズレている場合は「投稿主体 = Active X ID」「運営主体 = 承認済み X ID のどれか」が
  // 不一致なので、サイドバー上部に注意書きを出す。
  const activeX = u.active_x_user_id;
  const activeMatchesEditor = true;

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
      {!activeMatchesEditor ? (
        <p
          style={{
            margin: "0 0 8px",
            padding: "6px 8px",
            fontSize: 11,
            color: "var(--text-secondary)",
            background: "var(--accent-warning-soft, rgba(255,200,0,0.08))",
            border: "1px solid var(--accent-warning, #c08a00)",
            borderRadius: "var(--radius-sm)",
            lineHeight: 1.4,
          }}
        >
          運営操作は可能ですが、投稿・表示主体は現在の Active X ID
          {activeX ? ` (@${activeX})` : ""}
          に依存します。
        </p>
      ) : null}
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
