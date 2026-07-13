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
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { ConsolePanel } from "@/components/layout/ConsolePanel";
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

      <ConsolePanel title="基本情報">
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
      </ConsolePanel>

      <ConsolePanel title="所属イベント" separated>
        <EventGroupMembersEditor
          groupId={row.id}
          members={members.map((member) => ({
            event_id: member.event_id,
            title: member.title,
            start_time: member.start_time,
          }))}
          eventOptions={eventOptions}
        />
      </ConsolePanel>

      <ConsolePanel title="削除" tone="danger" separated compact>
        <DeleteEventGroupForm id={row.id} name={row.name} />
      </ConsolePanel>
    </div>
  );
}
