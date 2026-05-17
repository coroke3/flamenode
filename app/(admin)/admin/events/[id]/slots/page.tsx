import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { SlotBatchForm } from "@/components/admin/SlotBatchForm";
import { SlotList } from "@/components/admin/SlotList";

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
      <p className="fn-muted fn-text-xs fn-bold">EVENT SLOTS</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{ev.title}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        ID: {ev.id}
      </p>

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
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          <Icon name="clock" size={12} aria-hidden /> 枠管理
        </Link>
        <Link
          href={`/admin/events/${ev.id}/staff`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="users" size={12} aria-hidden /> 編集権限
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
