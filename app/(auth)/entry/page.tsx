import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { fetchActiveEvents } from "@/lib/db/queries";
import {
  events as eventsTable,
  slots as slotsTable,
} from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { sanitizeNextPath } from "#utils/next";
import {
  collapseReservationGroups,
  type SlotGroupRow,
} from "@/lib/utils/slotGrouping";
import {
  entryLoginRedirectTo,
  getOnboardingState,
  onboardingHref,
  onboardingRulesHref,
} from "@/lib/auth/onboarding";

export const metadata: Metadata = { title: "エントリー / 投稿" };
export const dynamic = "force-dynamic";

type ReservedSlot = {
  id: string;
  event_id: string;
  video_id: string | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  updated_at: number;
  event_title: string | null;
  event_entry_end_time: number | null;
};

type ReservedSlotGroup = SlotGroupRow & {
  event_title: string | null;
  event_entry_end_time: number | null;
};

export default async function EntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next, "/entry");
  const sessionUser = await getCurrentUser();
  const isLoggedIn = Boolean(sessionUser?.id);
  const db = getDatabase();
  const onboarding = await getOnboardingState(db, sessionUser);
  const onboardingNext = onboardingHref(next);

  const resolveWriteHref = (target: string): string => {
    if (!isLoggedIn) return `/entry?next=${encodeURIComponent(target)}`;
    if (!onboarding.isComplete) return onboardingHref(target);
    if (onboarding.needsTosAccept) {
      return onboardingRulesHref(onboardingHref(target));
    }
    return target;
  };
  const writeCtaLabel = (defaultLabel: string): string => {
    if (!isLoggedIn) return defaultLabel;
    if (!onboarding.isComplete) return "初期設定を続ける";
    if (onboarding.needsTosAccept) return "利用規約に同意して進む";
    return defaultLabel;
  };

  const activeEventsRaw = db ? await fetchActiveEvents(db).catch(() => []) : [];
  const activeEvents = activeEventsRaw
    .filter((event) => isAcceptingEntries(event))
    .sort((a, b) => {
      const endDiff =
        (a.entry_end_time ?? Number.POSITIVE_INFINITY) -
        (b.entry_end_time ?? Number.POSITIVE_INFINITY);
      return endDiff || (a.start_time ?? 0) - (b.start_time ?? 0);
    });
  const slotCounts = new Map<string, number>();
  if (db && activeEvents.length > 0) {
    const rows = await db
      .select({ event_id: slotsTable.event_id, count: sql<number>`COUNT(*)` })
      .from(slotsTable)
      .where(eq(slotsTable.status, "available"))
      .groupBy(slotsTable.event_id);
    for (const row of rows) slotCounts.set(row.event_id, Number(row.count ?? 0));
  }

  let reservedSlots: ReservedSlot[] = [];
  const activeX = sessionUser?.active_x_user_id ?? null;
  if (db && sessionUser?.id) {
    const ownerWhere = activeX
      ? or(
          eq(slotsTable.x_user_id, activeX),
          and(
            isNull(slotsTable.x_user_id),
            eq(slotsTable.reserved_by_user_id, sessionUser.id),
          )!,
        )
      : eq(slotsTable.reserved_by_user_id, sessionUser.id);
    reservedSlots = await db
      .select({
        id: slotsTable.id,
        event_id: slotsTable.event_id,
        video_id: slotsTable.video_id,
        slot_label: slotsTable.slot_label,
        start_time: slotsTable.start_time,
        sort_order: slotsTable.sort_order,
        status: slotsTable.status,
        reserved_by_user_id: slotsTable.reserved_by_user_id,
        x_user_id: slotsTable.x_user_id,
        display_name: slotsTable.display_name,
        reservation_group_id: slotsTable.reservation_group_id,
        updated_at: slotsTable.updated_at,
        event_title: eventsTable.title,
        event_entry_end_time: eventsTable.entry_end_time,
      })
      .from(slotsTable)
      .leftJoin(eventsTable, eq(slotsTable.event_id, eventsTable.id))
      .where(
        and(
          ownerWhere,
          or(
            eq(slotsTable.status, "reserved"),
            eq(slotsTable.status, "submitted"),
          )!,
        )!,
      )
      .orderBy(slotsTable.start_time, slotsTable.sort_order)
      .limit(24);
  }
  const groupedReservedSlots = collapseReservationGroups(reservedSlots).map(
    (slot) => slot as ReservedSlotGroup,
  );
  groupedReservedSlots.sort((a, b) => {
    const aNeedsSubmission = !a.video_id && a.status === "reserved";
    const bNeedsSubmission = !b.video_id && b.status === "reserved";
    if (aNeedsSubmission !== bNeedsSubmission) return aNeedsSubmission ? -1 : 1;
    const deadlineDiff =
      (a.event_entry_end_time ?? Number.POSITIVE_INFINITY) -
      (b.event_entry_end_time ?? Number.POSITIVE_INFINITY);
    return (
      deadlineDiff ||
      (a.start_time ?? Number.POSITIVE_INFINITY) -
        (b.start_time ?? Number.POSITIVE_INFINITY)
    );
  });

  return (
    <div className="fn-public-container fn-page fn-entry">
      <header className="fn-page-head">
        <span className="fn-eyebrow">entry</span>
        <h1 className="fn-display fn-page-title">参加・投稿</h1>
        <p className="fn-jp fn-page-lead">
          イベント参加、確保済み枠への提出、通常投稿をここから始められます。
        </p>
      </header>

      {!isLoggedIn ? (
        <section className="fn-entry-status fn-entry-status--warn">
          <div className="fn-entry-status-body">
            <h2 className="fn-jp fn-panel-title">まず Discord でログインしてください</h2>
            <p className="fn-jp fn-entry-status-lead">
              参加・投稿にはログインと初期設定が必要です。
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: entryLoginRedirectTo(next) });
              }}
              className={styles.btnRow}
            >
              <button type="submit" className="fn-btn fn-btn-primary fn-btn-lg">
                <Icon name="discord" size={14} aria-hidden /> Discord でログイン
              </button>
            </form>
          </div>
        </section>
      ) : !onboarding.isComplete ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h2 className="fn-jp fn-panel-title">初期設定が未完了です</h2>
            <p className="fn-jp fn-entry-status-lead">
              利用規約への同意と X ID 連携を完了してください。
            </p>
            <Link href={onboardingNext} className="fn-btn fn-btn-primary fn-mt-12">
              初期設定を続ける
            </Link>
          </div>
        </div>
      ) : !onboarding.canPost ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name="clock" size={18} aria-hidden />
          <div>
            <h2 className="fn-jp fn-panel-title">X ID 承認待ち</h2>
            <p className="fn-jp fn-entry-status-lead">
              枠確保は可能です。投稿は X ID 承認後に利用できます。
            </p>
          </div>
        </div>
      ) : (
        <div className="fn-entry-status fn-entry-status--ok">
          <Icon name="check" size={14} aria-hidden />
          <span>投稿可能{activeX ? ` · @${activeX}` : ""}</span>
          <Link
            href={`/dashboard/settings?next=${encodeURIComponent("/entry")}`}
            className="fn-link fn-entry-status-actions"
          >
            名義を切替
          </Link>
        </div>
      )}

      <div className={`fn-entry-grid ${styles.choiceGrid}`}>
        <section className={`fn-entry-card ${styles.choiceCard}`}>
          <h2 className={styles.cardTitle}>
            <Icon name="calendar" size={16} aria-hidden /> イベントに参加する
          </h2>
          <p className={styles.cardLead}>
            受付中のイベントの枠を確保して、作品を投稿できます。
          </p>

          {groupedReservedSlots.length > 0 ? (
            <div className={`${styles.slotPanel} ${styles.slotPanelProminent}`}>
              <div className={styles.slotPanelHeader}>
                <h3 className={styles.slotPanelTitle}>確保済み枠に提出する</h3>
                <span className={styles.slotPanelCount}>{groupedReservedSlots.length}件</span>
              </div>
              <ul className="fn-pc-slot-list">
                {groupedReservedSlots.map((slot) => {
                  const needsSubmission =
                    !slot.video_id && slot.status === "reserved";
                  const href = resolveWriteHref(`/entry/slotted?slot=${slot.id}`);
                  return (
                    <li key={slot.id}>
                      <div className={styles.slotRow}>
                        <Link href={href} className="fn-pc-slot">
                          <span className="fn-pc-slot-info">
                            <span className="fn-pc-slot-label">
                              {slot.event_title ?? slot.event_id}
                            </span>
                            <span className="fn-mono fn-pc-slot-event">
                              {slot.start_time
                                ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(
                                    slot.start_time,
                                    { timeOnly: true },
                                  )}`
                                : (slot.slot_label ?? "件数枠")}
                            </span>
                            {slot.is_group ? (
                              <span className={styles.slotDeadline}>
                                連続 {slot.group_size} 枠
                              </span>
                            ) : null}
                            {slot.event_entry_end_time != null ? (
                              <span className={styles.slotDeadline}>
                                提出期限: {formatUnix(slot.event_entry_end_time)}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                        {needsSubmission ? (
                          <Link href={href} className="fn-btn fn-btn-primary fn-btn-sm">
                            作品情報の登録を続ける
                          </Link>
                        ) : (
                          <span className={styles.slotSubmitted}>提出済み</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className={styles.eventList}>
            {activeEvents.length === 0 ? (
              <p className="fn-text-muted-sm">現在受付中のイベントはありません。</p>
            ) : (
              activeEvents.map((event) => (
                <Link
                  key={event.id}
                  href={resolveWriteHref(`/event/${event.id}/slots`)}
                  className={styles.eventCard}
                >
                  <span className={styles.eventCardTitle}>{event.title}</span>
                  <span className={styles.eventCardMeta}>
                    残り {slotCounts.get(event.id) ?? 0} 枠
                  </span>
                  {event.entry_end_time != null ? (
                    <span className={styles.eventCardMeta}>
                      募集終了: {formatUnix(event.entry_end_time)}
                    </span>
                  ) : null}
                </Link>
              ))
            )}
          </div>
        </section>

        <section className={`fn-entry-card ${styles.choiceCard}`}>
          <h2 className={styles.cardTitle}>
            <Icon name="edit" size={16} aria-hidden /> 過去の自分の作品を投稿する
          </h2>
          <p className={styles.cardLead}>
            イベント枠に関係なく既存作品を登録できます。
          </p>
          <div className={styles.btnRow}>
            <Link
              href={resolveWriteHref("/entry/unslotted")}
              className="fn-btn fn-btn-ghost"
            >
              <Icon name="edit" size={14} aria-hidden />
              {writeCtaLabel(isLoggedIn ? "枠なし投稿" : "ログインして枠なし投稿")}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
