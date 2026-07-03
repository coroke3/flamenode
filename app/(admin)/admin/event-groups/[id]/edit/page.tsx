import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { eventGroupEvents, eventGroups, events } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { EventGroupForm } from "@/components/admin/EventGroupForm";
import { EventGroupMembersEditor } from "@/components/admin/EventGroupMembersEditor";
import { DeleteEventGroupForm } from "@/components/admin/DeleteEventGroupForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { eventGroupPublicHref } from "@/lib/eventGroupRoutes";

export const metadata: Metadata = { title: "イベントグループ編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventGroupEditPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const row = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
  )[0];
  if (!row) notFound();

  const [members, eventOptions] = await Promise.all([
    db
      .select({
        event_id: eventGroupEvents.event_id,
        title: events.title,
        start_time: events.start_time,
      })
      .from(eventGroupEvents)
      .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
      .where(eq(eventGroupEvents.event_group_id, id))
      .orderBy(desc(events.start_time), asc(events.id)),
    db
      .select({ id: events.id, title: events.title, start_time: events.start_time })
      .from(events)
      .orderBy(desc(events.start_time))
      .limit(500),
  ]);

  return (
    <div>
      <AdminPageHeader
        title={`${row.name} を編集`}
        backHref="/admin/event-groups"
        backLabel="グループ一覧へ"
        actions={[
          ...(row.visibility_status === "public"
            ? [
                {
                  href: eventGroupPublicHref(row.slug),
                  label: "公開ページ",
                  icon: <Icon name="external" size={12} aria-hidden />,
                },
              ]
            : []),
          {
            href: `/admin/audit?table=event_groups&record=${encodeURIComponent(row.id)}`,
            label: "監査ログ",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
        ]}
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
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px" }}>
          基本情報
        </h2>
        <EventGroupForm
          mode="edit"
          initial={{
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            group_type: row.group_type,
            icon_url: row.icon_url,
            accent_color: row.accent_color,
            visibility_status: row.visibility_status,
          }}
        />
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px" }}>
          所属イベント
        </h2>
        <EventGroupMembersEditor
          groupId={row.id}
          members={members.map((m) => ({
            event_id: m.event_id,
            title: m.title,
            start_time: m.start_time,
          }))}
          eventOptions={eventOptions}
        />
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "16px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--accent-danger)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-danger)" }}>
          削除
        </h2>
        <DeleteEventGroupForm id={row.id} name={row.name} />
      </section>
    </div>
  );
}
