import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";
import { buildAccentVars } from "@/lib/theme/accent";
import { Icon } from "@/components/ui/Icon";
import type { SlotRow } from "@/components/event/SlotGrid";
import { buildPageMetadata } from "@/lib/seo";
import { parseEventPartsJson } from "@/lib/video/parseEventIds";
import { resolveSlotIntervalSec } from "@/lib/slots/slotGuidance";
import { loadStaticEventDetail } from "@/lib/publicData/loader";
import { EventSlotsViewerPanel } from "./EventSlotsViewerPanel";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadStaticEventDetail(id);
  return buildPageMetadata({
    path: `/event/${id}/slots`,
    title: loaded.data?.event.title
      ? `${loaded.data.event.title} 枠確保`
      : "枠確保",
    noIndex: true,
  });
}

async function loadPublicSlotBundle(id: string) {
  return withDatabase(async (db) => {
    const event = (
      await db
        .select({
          id: eventsTable.id,
          title: eventsTable.title,
          accent_color: eventsTable.accent_color,
          visibility_status: eventsTable.visibility_status,
          start_time: eventsTable.start_time,
          end_time: eventsTable.end_time,
          entry_start_time: eventsTable.entry_start_time,
          entry_end_time: eventsTable.entry_end_time,
          slot_type: eventsTable.slot_type,
          slot_visibility_mode: eventsTable.slot_visibility_mode,
          max_slots_per_video: eventsTable.max_slots_per_video,
          max_slot_reservation_groups_per_xid:
            eventsTable.max_slot_reservation_groups_per_xid,
          slot_interval_minutes: eventsTable.slot_interval_minutes,
          slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,
          parts_json: eventsTable.parts_json,
        })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.id, id),
            eq(eventsTable.visibility_status, "public"),
          )!,
        )
        .limit(1)
    )[0];
    if (!event) return null;

    // 匿名/public SSRではviewer所有権に必要なauth user情報を読まない。
    // public_name の場合だけ公開仕様上必要な名前/X ID/group/iconを投影する。
    let slotsForUi: SlotRow[];
    if (event.slot_visibility_mode === "public_name") {
      const rows = await db
        .select({
          id: slotsTable.id,
          slot_label: slotsTable.slot_label,
          start_time: slotsTable.start_time,
          sort_order: slotsTable.sort_order,
          status: slotsTable.status,
          display_name: slotsTable.display_name,
          x_user_id: slotsTable.x_user_id,
          reserved_x_id_snapshot: slotsTable.reserved_x_id_snapshot,
          reservation_group_id: slotsTable.reservation_group_id,
          creator_icon_url: videosTable.creator_icon_url,
        })
        .from(slotsTable)
        .leftJoin(videosTable, eq(slotsTable.video_id, videosTable.id))
        .where(eq(slotsTable.event_id, id))
        .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order));

      const groupKeys = new Map<string, string>();
      slotsForUi = rows.map((slot) => {
        let groupKey: string | null = null;
        if (slot.reservation_group_id) {
          groupKey = groupKeys.get(slot.reservation_group_id) ?? null;
          if (!groupKey) {
            groupKey = `group-${groupKeys.size + 1}`;
            groupKeys.set(slot.reservation_group_id, groupKey);
          }
        }
        return {
          id: slot.id,
          slot_label: slot.slot_label,
          start_time: slot.start_time,
          sort_order: slot.sort_order,
          status: slot.status,
          display_name: slot.display_name,
          reserved_x_id: slot.reserved_x_id_snapshot ?? slot.x_user_id,
          profile_x_user_id: slot.x_user_id,
          submitted_icon_url:
            slot.status === "submitted" && slot.creator_icon_url
              ? `/api/media/slot-submission-icon/${slot.id}`
              : null,
          is_owned_by_viewer: false,
          viewer_relation: "none",
          group_key: groupKey,
          x_user_id: null,
        };
      });
    } else {
      const rows = await db
        .select({
          id: slotsTable.id,
          slot_label: slotsTable.slot_label,
          start_time: slotsTable.start_time,
          sort_order: slotsTable.sort_order,
          status: slotsTable.status,
        })
        .from(slotsTable)
        .where(eq(slotsTable.event_id, id))
        .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order));

      slotsForUi = rows.map((slot) => ({
        id: slot.id,
        slot_label: slot.slot_label,
        start_time: slot.start_time,
        sort_order: slot.sort_order,
        status: slot.status,
        display_name: null,
        reserved_x_id: null,
        profile_x_user_id: null,
        submitted_icon_url: null,
        is_owned_by_viewer: false,
        viewer_relation: "none",
        group_key: null,
        x_user_id: null,
      }));
    }

    return { event, slotsForUi };
  });
}

export default async function EventSlotsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const bundle = await loadPublicSlotBundle(id);
  if (!bundle) notFound();

  const { event, slotsForUi } = bundle;
  if (slotsForUi.length === 0) redirect(`/event/${event.id}`);

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
    now >= event.entry_end_time;
  const slotTotal = slotsForUi.length;
  const availableSlots = slotsForUi.filter(
    (slot) => slot.status === "available",
  ).length;
  const filledSlots = Math.max(0, slotTotal - availableSlots);
  const fillRatio =
    slotTotal > 0
      ? Math.min(100, Math.round((filledSlots / slotTotal) * 100))
      : 0;
  const slotPartGapSec = (event.slot_part_gap_minutes ?? 15) * 60;
  const slotIntervalSec =
    event.slot_type === "count"
      ? null
      : resolveSlotIntervalSec({
          explicitMinutes: event.slot_interval_minutes,
          slots: slotsForUi,
          partGapSec: slotPartGapSec,
        });
  const parts = parseEventPartsJson(event.parts_json);
  const slotType = (event.slot_type ?? "time") as "time" | "count";

  return (
    <div
      className={`fn-public-container fn-page ${styles.page}`}
      style={buildAccentVars(event.accent_color, "dark")}
    >
      <header className={`fn-slots-head ${styles.header}`}>
        <p className="fn-page-back">
          <Link href={`/event/${event.id}`}>
            <Icon name="chevron-left" size={12} aria-hidden /> イベント詳細へ
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
              募集: {event.entry_start_time != null ? formatUnix(event.entry_start_time) : "-"}
              {" - "}
              {event.entry_end_time != null ? formatUnix(event.entry_end_time) : "-"}
            </span>
          ) : null}
        </div>
        <h1 className={`fn-reserve-title ${styles.title}`}>
          {event.title} の枠確保
        </h1>
        <div className={`fn-slots-stats ${styles.stats}`} aria-label="枠の状態">
          <strong>
            {filledSlots}<small>/{slotTotal}</small>
          </strong>
          <span>埋まり枠</span>
          <em>{fillRatio}% 埋まり</em>
        </div>
      </header>

      <EventSlotsViewerPanel
        eventId={event.id}
        eventTitle={event.title}
        baseSlots={slotsForUi}
        accepting={accepting}
        eventStatus={status}
        slotType={slotType}
        maxSlotsPerVideo={event.max_slots_per_video ?? 1}
        maxSlotReservationsPerXId={
          event.max_slot_reservation_groups_per_xid ?? 0
        }
        slotIntervalSec={slotIntervalSec}
        slotPartGapSec={slotPartGapSec}
        parts={parts}
        entryEndTime={event.entry_end_time ?? null}
      />
    </div>
  );
}
