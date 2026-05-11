import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventCollaboratorPermissions,
  eventEditors,
  events as eventsTable,
  xUsers,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import {
  EventStaffManager,
  type CollaboratorRow,
} from "@/components/admin/EventStaffManager";

export const metadata: Metadata = { title: "運営メンバー管理" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventStaffPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();
  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const editors = await db
    .select({
      x_user_id: eventEditors.x_user_id,
      role: eventEditors.role,
      is_public: eventEditors.is_public,
      public_role_label: eventEditors.public_role_label,
      internal_note: eventEditors.internal_note,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(eventEditors)
    .leftJoin(xUsers, eq(xUsers.id, eventEditors.x_user_id))
    .where(eq(eventEditors.event_id, id));

  // 協力者は1人につき複数 permission_key を持つので、subject (x_user or discord_user) でまとめる。
  const collabRows = await db
    .select()
    .from(eventCollaboratorPermissions)
    .where(eq(eventCollaboratorPermissions.event_id, id));

  const collabMap = new Map<string, CollaboratorRow>();
  for (const c of collabRows) {
    const key = `${c.x_user_id ?? ""}::${c.discord_user_id ?? ""}`;
    const existing = collabMap.get(key);
    if (existing) {
      existing.permission_keys.push(c.permission_key);
    } else {
      collabMap.set(key, {
        key,
        x_user_id: c.x_user_id,
        discord_user_id: c.discord_user_id,
        display_name: c.display_name,
        is_public_staff: c.is_public_staff,
        public_role_label: c.public_role_label,
        permission_keys: [c.permission_key],
      });
    }
  }

  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">EVENT STAFF</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{ev.title}</h1>

      <nav style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/admin/events/${ev.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
          <Icon name="grid" size={12} aria-hidden /> 概要
        </Link>
        <Link
          href={`/admin/events/${ev.id}/edit`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="edit" size={12} aria-hidden /> 設定編集
        </Link>
        <Link
          href={`/admin/events/${ev.id}/slots`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="clock" size={12} aria-hidden /> 枠管理
        </Link>
        <Link
          href={`/admin/events/${ev.id}/staff`}
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          <Icon name="users" size={12} aria-hidden /> 運営・協力者
        </Link>
      </nav>

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <EventStaffManager
          eventId={ev.id}
          editors={editors.map((e) => ({
            x_user_id: e.x_user_id,
            role: (e.role ?? "editor") as "editor" | "representative",
            is_public: e.is_public,
            public_role_label: e.public_role_label,
            internal_note: e.internal_note,
            x_name: e.x_name,
            icon_url: e.icon_url,
          }))}
          collaborators={Array.from(collabMap.values())}
        />
      </section>
    </div>
  );
}
