import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";
import { buildAccentVars } from "@/lib/theme/accent";
import { Icon } from "@/components/ui/Icon";
import { SlotGrid, type SlotRow } from "@/components/event/SlotGrid";
import { SlotStatusBoard } from "@/components/event/SlotStatusBoard";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await withDatabase(async (db) => {
    const rows = await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  });
  return { title: event?.title ? `${event.title} 枠確保` : "枠確保" };
}

export default async function EventSlotsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;

  const bundle = await withDatabase(async (db) => {
    const event = (
      await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
    )[0];
    if (!event) return null;

    const slotRows = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .orderBy(
        asc(slotsTable.start_time),
        asc(slotsTable.sort_order),
      );

    return { event, slotRows };
  });

  if (!bundle) notFound();

  const { event, slotRows } = bundle;

  // 枠が一件も設定されていない場合はイベントページにリダイレクト
  if (slotRows.length === 0) {
    redirect(`/event/${event.id}`);
  }
  const viewer = await getCurrentUser();
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);
  const now = Math.floor(Date.now() / 1000);
  const entryNotStartedYet =
    !accepting &&
    event.entry_start_time != null &&
    now < event.entry_start_time;
  const entryClosed =
    !accepting &&
    event.entry_end_time != null &&
    now > event.entry_end_time;

  const slotRowsForGrid: SlotRow[] = slotRows.map((slot) => ({
    id: slot.id,
    slot_kind: (slot.slot_kind ?? "time") as "time" | "count",
    slot_label: slot.slot_label,
    start_time: slot.start_time,
    sort_order: slot.sort_order,
    status: slot.status,
    display_name: slot.display_name,
    x_user_id: slot.x_user_id,
    discord_user_id: slot.discord_user_id,
    reservation_group_id: slot.reservation_group_id,
  }));

  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter(
    (slot) => slot.status === "available",
  ).length;
  const filledSlots = Math.max(0, slotTotal - availableSlots);
  const fillRatio =
    slotTotal > 0 ? Math.min(100, Math.round((filledSlots / slotTotal) * 100)) : 0;
  const slotPartGapSec = (event.slot_part_gap_minutes ?? 15) * 60;
  const accentStyle = buildAccentVars(event.accent_color, "dark");

  return (
    <div
      className={`fn-public-container fn-page ${styles.page}`}
      style={accentStyle}
    >
      <header className={`fn-slots-head ${styles.header}`}>
        <p className="fn-page-back">
          <Link href={`/event/${event.id}`}>
            <Icon name="chevron-left" size={12} aria-hidden />
            イベント詳細へ
          </Link>
        </p>
        <div className={`fn-slots-meta ${styles.meta}`}>
          <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
            {eventStatusLabel(status)}
          </span>
          {accepting ? (
            <span className="fn-badge fn-badge-soft">受付中</span>
          ) : entryNotStartedYet ? (
            <span className="fn-badge fn-badge-warning">募集開始前</span>
          ) : entryClosed ? (
            <span className="fn-badge fn-badge-neutral">募集終了</span>
          ) : null}
          {event.entry_start_time != null || event.entry_end_time != null ? (
            <span className={styles.period}>
              募集:{" "}
              {event.entry_start_time != null
                ? formatUnix(event.entry_start_time)
                : "-"}
              {" - "}
              {event.entry_end_time != null ? formatUnix(event.entry_end_time) : "-"}
            </span>
          ) : null}
        </div>
        <h1 className={`fn-reserve-title ${styles.title}`}>{event.title} の枠確保</h1>
        <div className={`fn-slots-stats ${styles.stats}`} aria-label="枠の状態">
          <strong>
            {filledSlots}
            <small>/{slotTotal}</small>
          </strong>
          <span>埋まり枠</span>
          <em>{fillRatio}% 埋まり</em>
        </div>
      </header>

      {!accepting ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden />
          {status === "ended"
            ? "終了済みのため新規確保はできません。"
            : status === "scheduled"
              ? "受付開始までお待ちください。"
              : "現在は受付停止中です。"}
        </p>
      ) : !viewer?.id ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> 確保には{" "}
          <Link
            href={`/entry?next=${encodeURIComponent(`/event/${event.id}/slots`)}`}
          >
            ログイン
          </Link>{" "}
          とアクティブ X ID が必要です。
        </p>
      ) : !viewer.active_x_user_id ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> アクティブ X ID を選択してください
          ({" "}
          <Link
            href={`/dashboard/settings?next=${encodeURIComponent(`/event/${event.id}/slots`)}`}
          >
            設定
          </Link>{" "}
          )。
        </p>
      ) : null}

      <div className={styles.layout}>
        <main className={styles.main}>
          <SlotGrid
            slots={slotRowsForGrid}
            viewerXId={viewer?.active_x_user_id ?? null}
            viewerActiveX={viewer?.active_x_user_id ?? null}
            viewerDiscordId={viewer?.id ?? null}
            canReserve={accepting}
            slotKind={(event.slot_type ?? "time") as "time" | "count"}
            maxConsecutiveSlots={event.max_consecutive_slots_per_entry ?? 1}
            slotPartGapSec={slotPartGapSec}
          />
        </main>
        {slotRowsForGrid.length > 0 ? (
          <aside className={styles.aside}>
            <SlotStatusBoard
              slots={slotRowsForGrid}
              slotPartGapSec={slotPartGapSec}
              eventTitle={event.title}
              slotFormatLabel={
                event.slot_type === "count" ? "番号枠" : "単枠 / 上映枠"
              }
              deadlineLabel={
                event.entry_end_time != null
                  ? formatUnix(event.entry_end_time)
                  : null
              }
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
