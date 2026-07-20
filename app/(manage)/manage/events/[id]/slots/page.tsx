import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  events as eventsTable,
  slots as slotsTable,
} from "@/lib/db/schema";
import { canEditEvent } from "@/lib/auth/ownership";
import { SlotBatchForm } from "@/components/admin/SlotBatchForm";
import { SlotList } from "@/components/admin/SlotList";
import { EmptyState } from "@/components/ui/EmptyState";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `枠運営 (${id})` };
}

export default async function ManageEventSlotsPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const statusFilter: "all" | "available" | "reserved" | "submitted" =
    search.status === "available" ||
    search.status === "reserved" ||
    search.status === "submitted"
      ? search.status
      : "all";
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/slots`,
  });
  if (!guard.ok) return guard.element;
  const db = getDatabase();
  if (!db) notFound();

  const event = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!event) notFound();
  const isAdmin = guard.user.role === "admin";
  if (
    !isAdmin &&
    !(await canEditEvent(
      db,
      { id: guard.user.id, role: guard.user.role ?? null },
      id,
      "event.slots",
    ))
  ) {
    notFound();
  }

  const where =
    statusFilter === "all"
      ? eq(slotsTable.event_id, id)
      : and(
          eq(slotsTable.event_id, id),
          eq(slotsTable.status, statusFilter),
        )!;
  const rows = await db
    .select({
      id: slotsTable.id,
      event_id: slotsTable.event_id,
      slot_label: slotsTable.slot_label,
      start_time: slotsTable.start_time,
      sort_order: slotsTable.sort_order,
      status: slotsTable.status,
      display_name: slotsTable.display_name,
      x_user_id: slotsTable.x_user_id,
      reserved_by_user_id: slotsTable.reserved_by_user_id,
      reservation_group_id: slotsTable.reservation_group_id,
      video_id: slotsTable.video_id,
      updated_at: slotsTable.updated_at,
      version: slotsTable.version,
    })
    .from(slotsTable)
    .where(where)
    .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order))
    .limit(500);

  const countRows = await db
    .select({ status: slotsTable.status, count: sql<number>`COUNT(*)` })
    .from(slotsTable)
    .where(eq(slotsTable.event_id, id))
    .groupBy(slotsTable.status);
  const counts = Object.fromEntries(
    countRows.map((row) => [row.status, Number(row.count ?? 0)]),
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div style={manageEventAccentStyle(event.accent_color)}>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>枠運営: {event.title}</h1>
      <p className="fn-muted fn-text-sm">
        枠の生成、空き枠整理、予約枠の解放を行います。全{total}件中、最大500件を表示します。
      </p>
      <ManageEventTabs eventId={id} isAdmin={isAdmin} />

      <section className="fn-console-section">
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>一括生成 / 空き枠整理</h2>
        <SlotBatchForm eventId={event.id} />
      </section>

      <nav
        aria-label="状態フィルタ"
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 18 }}
      >
        {(
          [
            ["all", "すべて"],
            ["available", "空き"],
            ["reserved", "確保済"],
            ["submitted", "提出済"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={
              key === "all"
                ? `/manage/events/${id}/slots`
                : `/manage/events/${id}/slots?status=${key}`
            }
            className={`fn-btn fn-btn-sm ${
              statusFilter === key ? "fn-btn-primary" : "fn-btn-ghost"
            }`}
          >
            {label} ({key === "all" ? total : (counts[key] ?? 0)})
          </Link>
        ))}
      </nav>

      <section className="fn-console-section">
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>枠一覧 ({rows.length})</h2>
        {total === 0 ? (
          <EmptyState
            tone="warning"
            title="枠はまだありません"
            description="上のフォームから作成してください。"
            actions={[
              {
                href: `/manage/events/${id}`,
                label: "イベント運営トップへ",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <SlotList
            eventId={id}
            slots={rows}
            slotPartGapSec={(event.slot_part_gap_minutes ?? 15) * 60}
          />
        )}
      </section>
    </div>
  );
}
