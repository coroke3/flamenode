import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable, slots as slotsTable } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { collapseReservationGroups, type SlotBase } from "@/lib/utils/slotGrouping";

export const metadata: Metadata = { title: "投稿方法を選択" };
export const dynamic = "force-dynamic";

type ReservedSlot = {
  id: string;
  event_id: string;
  video_id: string | null;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  end_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  discord_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  priority_reclaim_until: number | null;
  priority_reclaim_video_id: string | null;
  updated_at: number;
  event_title: string | null;
};

export default async function PostChooserPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const db = getDatabase();
  const activeX = guard.user.active_x_user_id ?? null;
  let reservedSlots: ReservedSlot[] = [];

  if (db) {
    const ownerWhere = activeX
      ? or(
          eq(slotsTable.x_user_id, activeX),
          and(isNull(slotsTable.x_user_id), eq(slotsTable.discord_user_id, guard.user.id))!,
        )
      : eq(slotsTable.discord_user_id, guard.user.id);
    reservedSlots = await db
      .select({
        id: slotsTable.id,
        event_id: slotsTable.event_id,
        video_id: slotsTable.video_id,
        slot_kind: slotsTable.slot_kind,
        slot_label: slotsTable.slot_label,
        start_time: slotsTable.start_time,
        end_time: slotsTable.end_time,
        sort_order: slotsTable.sort_order,
        status: slotsTable.status,
        discord_user_id: slotsTable.discord_user_id,
        x_user_id: slotsTable.x_user_id,
        display_name: slotsTable.display_name,
        reservation_group_id: slotsTable.reservation_group_id,
        priority_reclaim_until: slotsTable.priority_reclaim_until,
        priority_reclaim_video_id: slotsTable.priority_reclaim_video_id,
        updated_at: slotsTable.updated_at,
        event_title: eventsTable.title,
      })
      .from(slotsTable)
      .leftJoin(eventsTable, eq(eventsTable.id, slotsTable.event_id))
      .where(
        and(
          ownerWhere,
          eq(slotsTable.status, "reserved"),
        )!,
      )
      .orderBy(slotsTable.start_time, slotsTable.end_time, slotsTable.sort_order)
      .limit(12);
  }

  const displaySlots = collapseReservationGroups(reservedSlots as SlotBase[]);

  return (
    <div
      style={{
        width: "min(96%, 980px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <p className="fn-muted fn-text-xs fn-bold">POST</p>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>投稿方法を選択</h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          イベント枠を確保している作品は「枠あり提出」から、通常の作品は「枠なし投稿」から進めます。
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          gap: 14,
        }}
      >
        <section className="fn-card">
          <div className="fn-card-body">
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>枠あり提出</h2>
            <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
              確保済みのイベント枠に作品情報を紐付けます。
            </p>
            {displaySlots.length === 0 ? (
              <div style={{ marginTop: 14 }}>
                <p className="fn-muted fn-text-sm">
                  現在、未提出の確保済み枠はありません。
                </p>
                <Link href="/entry" className="fn-btn fn-btn-primary fn-mt-md">
                  <Icon name="calendar" size={13} aria-hidden /> 枠を確保する
                </Link>
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                {displaySlots.map((slot) => (
                  <Link
                    key={slot.id}
                    href={`/dashboard/post/slotted?slot=${slot.id}`}
                    className="fn-btn fn-btn-ghost"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      whiteSpace: "normal",
                      textAlign: "left",
                    }}
                  >
                    <span>
                      <strong>{slot.event_title ?? slot.event_id}</strong>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {slot.start_time
                          ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}${slot.end_time ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}` : ""}`
                          : (slot.slot_label ?? "時間なし枠")}
                        {slot.is_group ? ` / ${slot.group_size}連続` : ""}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={13} aria-hidden />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="fn-card">
          <div className="fn-card-body">
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>枠なし投稿</h2>
            <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
              イベント枠に紐づかない作品を通常投稿として登録します。
            </p>
            <Link
              href="/dashboard/post/unslotted"
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              <Icon name="edit" size={13} aria-hidden /> 枠なしで投稿する
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
