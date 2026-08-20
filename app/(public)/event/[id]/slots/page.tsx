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
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getOnboardingState,
  onboardingRulesHref,
} from "@/lib/auth/onboarding";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";
import { buildAccentVars } from "@/lib/theme/accent";
import { Icon } from "@/components/ui/Icon";
import { SlotGrid } from "@/components/event/SlotGrid";
import { SlotStatusBoard } from "@/components/event/SlotStatusBoard";
import { buildPageMetadata } from "@/lib/seo";
import {
  canActAsSlotActor,
  resolveSlotViewerRelation,
} from "@/lib/slots/slotIdentityCore";
import { resolveReservationXIdentity } from "@/lib/slots/reservationIdentity";
import { canUseSlotOperatorOverride } from "@/lib/slots/operatorReservationCore";
import {
  canEditEventFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await withDatabase(async (db) =>
    (
      await db
        .select({ title: eventsTable.title })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.id, id),
            eq(eventsTable.visibility_status, "public"),
          ),
        )
        .limit(1)
    )[0] ?? null,
  );
  return buildPageMetadata({
    path: `/event/${id}/slots`,
    title: event?.title ? `${event.title} 枠確保` : "枠確保",
    noIndex: true,
  });
}

export default async function EventSlotsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const bundle = await withDatabase(async (db) => {
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
          slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,
        })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.id, id),
            eq(eventsTable.visibility_status, "public"),
          ),
        )
        .limit(1)
    )[0];
    if (!event) return null;
    const slotRows = await db
      .select({
        id: slotsTable.id,
        slot_label: slotsTable.slot_label,
        start_time: slotsTable.start_time,
        sort_order: slotsTable.sort_order,
        status: slotsTable.status,
        display_name: slotsTable.display_name,
        x_user_id: slotsTable.x_user_id,
        reserved_x_id_snapshot: slotsTable.reserved_x_id_snapshot,
        reserved_by_user_id: slotsTable.reserved_by_user_id,
        reservation_group_id: slotsTable.reservation_group_id,
        creator_icon_url: videosTable.creator_icon_url,
      })
      .from(slotsTable)
      .leftJoin(videosTable, eq(slotsTable.video_id, videosTable.id))
      .where(eq(slotsTable.event_id, id))
      .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order));
    return { event, slotRows };
  });
  if (!bundle) notFound();

  const { event, slotRows } = bundle;
  if (slotRows.length === 0) redirect(`/event/${event.id}`);

  const viewer = await getCurrentUser();
  const onboarding =
    (await withDatabase((db) => getOnboardingState(db, viewer))) ??
    (await getOnboardingState(null, viewer));
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

  let operatorOverrideAllowed = false;
  if (
    viewer?.id &&
    (viewer.role === "admin" || onboarding.xIdentityStatus === "approved")
  ) {
    const authorization = await getManageAuthorizationSnapshot(
      viewer.id,
      viewer.role ?? null,
    );
    operatorOverrideAllowed =
      canEditEventFromSnapshot(authorization, event.id, "event.slots") &&
      onboarding.canReserveSlot &&
      canUseSlotOperatorOverride(event, now);
  }

  const groupKeys = new Map<string, string>();
  const slotsForUi = slotRows.map((slot) => {
    const viewerRelation = resolveSlotViewerRelation({
      reservedByUserId: slot.reserved_by_user_id,
      slotXUserId: slot.x_user_id,
      authUserId: viewer?.id ?? null,
      activeXId: viewer?.active_x_user_id ?? null,
    });
    const isOwnedByViewer = canActAsSlotActor(viewerRelation);
    const canReveal =
      viewerRelation === "active" ||
      viewerRelation === "unassigned" ||
      viewerRelation === "account_other" ||
      event.slot_visibility_mode === "public_name";
    let groupKey: string | null = null;
    const exposeGroupKey =
      isOwnedByViewer || event.slot_visibility_mode === "public_name";
    if (exposeGroupKey && slot.reservation_group_id) {
      groupKey = groupKeys.get(slot.reservation_group_id) ?? null;
      if (!groupKey) {
        groupKey = `group-${groupKeys.size + 1}`;
        groupKeys.set(slot.reservation_group_id, groupKey);
      }
    }
    const submittedIconUrl =
      canReveal &&
      slot.status === "submitted" &&
      slot.creator_icon_url
        ? `/api/media/slot-submission-icon/${slot.id}`
        : null;
    return {
      id: slot.id,
      slot_label: slot.slot_label,
      start_time: slot.start_time,
      sort_order: slot.sort_order,
      status: slot.status,
      display_name: canReveal ? slot.display_name : null,
      reserved_x_id: canReveal
        ? (slot.reserved_x_id_snapshot ?? slot.x_user_id)
        : null,
      profile_x_user_id:
        canReveal && slot.x_user_id ? slot.x_user_id : null,
      submitted_icon_url: submittedIconUrl,
      is_owned_by_viewer: isOwnedByViewer,
      viewer_relation: viewerRelation,
      group_key: groupKey,
      x_user_id: isOwnedByViewer ? slot.x_user_id : null,
    };
  });
  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter(
    (slot) => slot.status === "available",
  ).length;
  const filledSlots = Math.max(0, slotTotal - availableSlots);
  const fillRatio =
    slotTotal > 0
      ? Math.min(100, Math.round((filledSlots / slotTotal) * 100))
      : 0;
  const slotPartGapSec = (event.slot_part_gap_minutes ?? 15) * 60;

  let viewerXId: string | null = null;
  let viewerXIdNotice: string | null = null;
  if (viewer?.id && onboarding.canReserveSlot) {
    const identity = await withDatabase((db) =>
      resolveReservationXIdentity(db, {
        user: { id: viewer.id },
        activeXId: viewer.active_x_user_id,
        approvedXIds: onboarding.activeApprovedXId
          ? [onboarding.activeApprovedXId]
          : [],
        hasPendingXRequest: onboarding.xIdentityStatus === "pending",
      }),
    );
    if (!identity) {
      viewerXId = null;
    } else if ("error" in identity) {
      viewerXId = null;
      viewerXIdNotice = identity.error;
    } else {
      viewerXId = identity.snapshotXId;
    }
  }

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

      {!accepting && !operatorOverrideAllowed ? (
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
          <Icon name="info" size={13} aria-hidden /> 確保には
          <Link href={`/entry?next=${encodeURIComponent(`/event/${event.id}/slots`)}`}>
            ログイン
          </Link>
          が必要です。
        </p>
      ) : onboarding.needsTermsAcceptance ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> 確保には
          <Link href={onboardingRulesHref(`/event/${event.id}/slots`)}>
            利用規約への同意
          </Link>
          が必要です。
        </p>
      ) : !accepting && operatorOverrideAllowed ? (
        <p className={styles.notice} role="note">
          <Icon name="warning" size={13} aria-hidden />
          イベント運営権限で、募集開始前の枠確保やイベント上限を超える予約ができます。実行時に警告を確認してください。
        </p>
      ) : null}

      {viewerXIdNotice ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> {viewerXIdNotice}
        </p>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <SlotGrid
            slots={slotsForUi}
            viewerXId={viewerXId}
            isAuthenticated={Boolean(viewer?.id)}
            canReserve={accepting}
            canTakeSlot={
              onboarding.canReserveSlot &&
              (accepting || operatorOverrideAllowed)
            }
            operatorOverrideAllowed={operatorOverrideAllowed}
            canPost={onboarding.canPost}
            slotType={(event.slot_type ?? "time") as "time" | "count"}
            maxSlotsPerVideo={event.max_slots_per_video ?? 1}
            slotPartGapSec={slotPartGapSec}
          />
        </div>
        <aside className={styles.aside}>
          <SlotStatusBoard
            slots={slotsForUi}
            slotPartGapSec={slotPartGapSec}
            eventTitle={event.title}
            slotFormatLabel={
              event.slot_type === "count" ? "番号枠" : "時間枠"
            }
            deadlineLabel={
              event.entry_end_time != null
                ? formatUnix(event.entry_end_time)
                : null
            }
          />
        </aside>
      </div>
    </div>
  );
}
