import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
} from "@/lib/db/schema";
import { SlotBatchForm } from "@/components/admin/SlotBatchForm";
import { SlotList } from "@/components/admin/SlotList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "枠管理" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventSlotsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();
  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const rows = await db
    .select({
      id: slotsTable.id,
      slot_kind: slotsTable.slot_kind,
      slot_label: slotsTable.slot_label,
      start_time: slotsTable.start_time,
      end_time: slotsTable.end_time,
      sort_order: slotsTable.sort_order,
      status: slotsTable.status,
      display_name: slotsTable.display_name,
      x_user_id: slotsTable.x_user_id,
      discord_user_id: slotsTable.discord_user_id,
      reservation_group_id: slotsTable.reservation_group_id,
    })
    .from(slotsTable)
    .where(eq(slotsTable.event_id, id))
    .orderBy(slotsTable.start_time, slotsTable.end_time, slotsTable.sort_order);

  return (
    <div>
      <AdminPageHeader
        title={`${ev.title} の枠管理`}
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
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          一括生成
        </h2>
        <SlotBatchForm eventId={ev.id} />
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
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          枠一覧 ({rows.length})
        </h2>
        <SlotList
          slots={rows}
          slotPartGapSec={(ev.slot_part_gap_minutes ?? 30) * 60}
        />
      </section>
    </div>
  );
}
