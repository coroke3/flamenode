import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  slots as slotsTable,
  users as usersTable,
} from "@/lib/db/schema";
import {
  canEditEventFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { SlotBatchForm } from "@/components/admin/SlotBatchForm";
import { SlotList } from "@/components/admin/SlotList";
import { EmptyState } from "@/components/ui/EmptyState";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import { getManageEventForRender } from "@/lib/manage/manageEventRender";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: `枠管理 (${id})` };
  const ev = await getManageEventForRender(id);
  return { title: ev?.title ? `${ev.title} 枠管理` : "枠管理" };
}

const STATUS_FILTERS = [
  ["all", "すべて"],
  ["available", "空き"],
  ["reserved", "確保済"],
  ["submitted", "提出済"],
] as const;

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

  const event = await getManageEventForRender(id);
  if (!event) notFound();
  const eventHrefId = encodeURIComponent(id);
  const isAdmin = guard.user.role === "admin";
  const authorization = await getManageAuthorizationSnapshot(
    guard.user.id,
    guard.user.role ?? null,
  );
  if (!canEditEventFromSnapshot(authorization, id, "event.slots")) {
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
      reserved_x_id_snapshot: slotsTable.reserved_x_id_snapshot,
      reserved_by_user_id: slotsTable.reserved_by_user_id,
      discord_display_name: usersTable.name,
      discord_id: usersTable.discord_id,
      reservation_group_id: slotsTable.reservation_group_id,
      video_id: slotsTable.video_id,
      updated_at: slotsTable.updated_at,
      version: slotsTable.version,
    })
    .from(slotsTable)
    .leftJoin(usersTable, eq(slotsTable.reserved_by_user_id, usersTable.id))
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
  const navigation = await getManageNavigationSnapshot(
    guard.user.id,
    guard.user.role ?? null,
  );
  const pendingCount = navigation.pendingByEvent.get(id) ?? 0;

  return (
    <ManageEventPageShell
      eventId={id}
      title={event.title}
      description={`枠管理 — 全${total}件中、最大500件を表示`}
      backHref={`/manage/events/${eventHrefId}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(event.accent_color)}
    >
      <nav aria-label="枠の状態" className="manage-slot-stats">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === "all" ? total : (counts[key] ?? 0);
          const href =
            key === "all"
              ? `/manage/events/${eventHrefId}/slots`
              : `/manage/events/${eventHrefId}/slots?status=${key}`;
          return (
            <Link
              key={key}
              href={href}
              className="manage-slot-stat"
              aria-current={statusFilter === key ? "page" : undefined}
            >
              <span className="manage-slot-stat-label">{label}</span>
              <span className="manage-slot-stat-value">{count}</span>
            </Link>
          );
        })}
      </nav>

      <section className="manage-section">
        <SlotBatchForm
          eventId={event.id}
          totalSlots={total}
          variant="manage"
        />
      </section>

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">枠一覧 ({rows.length})</h2>
        {total === 0 ? (
          <EmptyState
            tone="warning"
            title="枠はまだありません"
            description="上のフォームから作成してください。"
            actions={[
              {
                href: `/manage/events/${eventHrefId}`,
                label: "イベント概要へ",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <SlotList
            eventId={id}
            slots={rows}
            slotPartGapSec={(event.slot_part_gap_minutes ?? 15) * 60}
            variant="manage"
            canForceReleaseSubmitted={isAdmin}
          />
        )}
      </section>
    </ManageEventPageShell>
  );
}
