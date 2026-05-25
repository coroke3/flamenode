import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventStaff,
  eventStaffPermissions,
  events as eventsTable,
  xUsers,
} from "@/lib/db/schema";
import {
  EventStaffManager,
  type CollaboratorRow,
} from "@/components/admin/EventStaffManager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "イベント管理者を登録/編集" };
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
      x_user_id: eventStaff.x_user_id,
      role: eventStaff.role,
      is_public: eventStaff.is_public,
      public_role_label: eventStaff.public_role_label,
      internal_note: eventStaff.internal_note,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(eventStaff)
    .leftJoin(xUsers, eq(xUsers.id, eventStaff.x_user_id))
    .where(
      and(
        eq(eventStaff.event_id, id),
        inArray(eventStaff.role, ["editor", "representative"]),
      )!,
    );

  const permissionRows = await db
    .select({
      staff_id: eventStaff.id,
      x_user_id: eventStaff.x_user_id,
      discord_user_id: eventStaff.discord_user_id,
      display_name: eventStaff.display_name,
      is_public_staff: eventStaff.is_public,
      public_role_label: eventStaff.public_role_label,
      permission_key: eventStaffPermissions.permission_key,
    })
    .from(eventStaff)
    .innerJoin(
      eventStaffPermissions,
      eq(eventStaffPermissions.event_staff_id, eventStaff.id),
    )
    .where(
      and(eq(eventStaff.event_id, id), eq(eventStaffPermissions.allowed, 1))!,
    );

  const collabMap = new Map<string, CollaboratorRow>();
  for (const row of permissionRows) {
    const existing = collabMap.get(row.staff_id);
    if (existing) {
      existing.permission_keys.push(row.permission_key);
    } else {
      collabMap.set(row.staff_id, {
        key: row.staff_id,
        x_user_id: row.x_user_id,
        discord_user_id: row.discord_user_id,
        display_name: row.display_name,
        is_public_staff: row.is_public_staff,
        public_role_label: row.public_role_label,
        permission_keys: [row.permission_key],
      });
    }
  }

  return (
    <div>
      <AdminPageHeader
        title={`${ev.title} のイベント管理者を登録/編集`}
        description={`ID: ${ev.id}`}
        backHref={`/admin/events/${ev.id}`}
        backLabel="イベント詳細へ"
      />

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
          editors={editors
            .filter((e) => e.x_user_id)
            .map((e) => ({
              x_user_id: e.x_user_id ?? "",
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
