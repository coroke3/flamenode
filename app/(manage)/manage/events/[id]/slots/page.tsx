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
  const sp = (await searchParams) ?? {};
  const statusFilter: "all" | "available" | "reserved" | "submitted" =
    sp.status === "available" ||
    sp.status === "reserved" ||
    sp.status === "submitted"
      ? sp.status
      : "all";

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/slots`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const isAdmin = user.role === "admin";
  const canManageSlots = await canEditEvent(
    db,
    { id: user.id, role: user.role ?? null },
    id,
    "event.slots",
  );
  if (!canManageSlots && !isAdmin) notFound();

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
      slot_kind: slotsTable.slot_kind,
      slot_label: slotsTable.slot_label,
      start_time: slotsTable.start_time,
      sort_order: slotsTable.sort_order,
      status: slotsTable.status,
      display_name: slotsTable.display_name,
      x_user_id: slotsTable.x_user_id,
      discord_user_id: slotsTable.discord_user_id,
      reservation_group_id: slotsTable.reservation_group_id,
    })
    .from(slotsTable)
    .where(where)
    .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order))
    .limit(500);

  const countRows = await db
    .select({
      status: slotsTable.status,
      c: sql<number>`COUNT(*)`,
    })
    .from(slotsTable)
    .where(eq(slotsTable.event_id, id))
    .groupBy(slotsTable.status);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status ?? "unknown"] = Number(r.c ?? 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <p style={{ marginBottom: 8, fontSize: 12 }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>
        枠運営: {ev.title}
      </h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
        枠の生成、空き枠整理、確保済み枠の解放をここで扱えます。{total} 件中、最大 500 件を表示します。
      </p>
      <ManageEventTabs eventId={id} active="slots" isAdmin={isAdmin} />

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
          一括生成 / 空き枠整理
        </h2>
        <SlotBatchForm eventId={ev.id} />
      </section>

      <nav
        aria-label="状態フィルタ"
        style={{
          marginTop: 22,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "すべて"],
            ["available", "空き"],
            ["reserved", "確保済"],
            ["submitted", "提出済"],
          ] as const
        ).map(([key, label]) => {
          const count = key === "all" ? total : (counts[key] ?? 0);
          const href =
            key === "all"
              ? `/manage/events/${id}/slots`
              : `/manage/events/${id}/slots?status=${key}`;
          return (
            <Link
              key={key}
              href={href}
              className={`fn-btn fn-btn-sm ${statusFilter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            >
              {label} ({count})
            </Link>
          );
        })}
      </nav>

      <section
        style={{
          marginTop: 14,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          枠一覧 ({rows.length})
        </h2>
        {total === 0 ? (
          <EmptyState
            tone="warning"
            title="枠はまだありません"
            description="このイベントにはまだ投稿枠が設定されていません。上のフォームから一括生成してください。"
            actions={[
              ...(isAdmin
                ? [
                    {
                      href: `/manage/events/${id}/slots`,
                      label: "管理者用枠編集へ",
                      variant: "primary" as const,
                    },
                  ]
                : [
                    {
                      href: `/manage/events/${id}`,
                      label: "イベント運営トップへ",
                      variant: "ghost" as const,
                    },
                    {
                      href: `/event/${id}`,
                      label: "公開ページを見る",
                      variant: "ghost" as const,
                    },
                  ]),
            ]}
          />
        ) : (
          <SlotList
            slots={rows}
            slotPartGapSec={(ev.slot_part_gap_minutes ?? 15) * 60}
          />
        )}
      </section>
    </div>
  );
}
