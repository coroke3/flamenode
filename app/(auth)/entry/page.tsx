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
import { collapseReservationGroups, type SlotBase } from "@/lib/utils/slotGrouping";
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
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  priority_reclaim_until: number | null;
  priority_reclaim_video_id: string | null;
  updated_at: number;
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
  const isLoggedIn = !!sessionUser?.id;
  const db = getDatabase();
  const onboarding = await getOnboardingState(db, sessionUser);
  const onboardingNext = onboardingHref(next);

  const resolveWriteHref = (target: string): string => {
    if (!isLoggedIn) {
      return `/entry?next=${encodeURIComponent(target)}`;
    }
    if (!onboarding.isComplete) {
      return onboardingHref(target);
    }
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
    .filter((ev) => isAcceptingEntries(ev))
    .sort((a, b) => {
      const aEnd = a.entry_end_time ?? Number.POSITIVE_INFINITY;
      const bEnd = b.entry_end_time ?? Number.POSITIVE_INFINITY;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return (a.start_time ?? 0) - (b.start_time ?? 0);
    });
  const slotCounts = new Map<string, number>();
  if (db && activeEvents.length > 0) {
    const rows = await db
      .select({
        event_id: slotsTable.event_id,
        count: sql<number>`COUNT(*)`,
      })
      .from(slotsTable)
      .where(eq(slotsTable.status, "available"))
      .groupBy(slotsTable.event_id);
    rows.forEach((row) => slotCounts.set(row.event_id, Number(row.count ?? 0)));
  }

  let reservedSlots: ReservedSlot[] = [];
  const activeX = sessionUser?.active_x_user_id ?? null;
  if (db && sessionUser?.id) {
    const ownerWhere = activeX
      ? or(
          eq(slotsTable.x_user_id, activeX),
          and(isNull(slotsTable.x_user_id), eq(slotsTable.reserved_by_user_id, sessionUser.id))!,
        )
      : eq(slotsTable.reserved_by_user_id, sessionUser.id);
    reservedSlots = await db
      .select({
        id: slotsTable.id,
        event_id: slotsTable.event_id,
        video_id: slotsTable.video_id,
        slot_kind: slotsTable.slot_kind,
        slot_label: slotsTable.slot_label,
        start_time: slotsTable.start_time,
        sort_order: slotsTable.sort_order,
        status: slotsTable.status,
        reserved_by_user_id: slotsTable.reserved_by_user_id,
        x_user_id: slotsTable.x_user_id,
        display_name: slotsTable.display_name,
        reservation_group_id: slotsTable.reservation_group_id,
        priority_reclaim_until: slotsTable.priority_reclaim_until,
        priority_reclaim_video_id: slotsTable.priority_reclaim_video_id,
        updated_at: slotsTable.updated_at,
        event_title: eventsTable.title,
        event_entry_end_time: eventsTable.entry_end_time,
      })
      .from(slotsTable)
      .leftJoin(eventsTable, eq(slotsTable.event_id, eventsTable.id))
      .where(
        and(
          ownerWhere,
          or(eq(slotsTable.status, "reserved"), eq(slotsTable.status, "submitted"))!,
        )!,
      )
      .orderBy(slotsTable.start_time, slotsTable.sort_order)
      .limit(12);
  }

  type EntrySlotGroup = ReturnType<typeof collapseReservationGroups>[number] & {
    event_entry_end_time?: number | null;
  };
  const displaySlots = (collapseReservationGroups(
    reservedSlots as SlotBase[],
  ) as EntrySlotGroup[]).sort((a, b) => {
    const aNeedsSubmission = !a.video_id && a.status === "reserved";
    const bNeedsSubmission = !b.video_id && b.status === "reserved";
    if (aNeedsSubmission !== bNeedsSubmission) return aNeedsSubmission ? -1 : 1;
    const aDeadline = a.event_entry_end_time ?? Number.POSITIVE_INFINITY;
    const bDeadline = b.event_entry_end_time ?? Number.POSITIVE_INFINITY;
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    return (a.start_time ?? Number.POSITIVE_INFINITY) - (b.start_time ?? Number.POSITIVE_INFINITY);
  });
  const canPost = onboarding.canPost;

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
        <section
          className="fn-entry-status fn-entry-status--warn"
          aria-labelledby="login-card"
        >
          <div className="fn-entry-status-body">
            <h2 id="login-card" className="fn-jp fn-panel-title">
              まず Discord でログインしてください
            </h2>
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
                <Icon name="discord" size={14} aria-hidden />
                Discord でログイン
              </button>
            </form>
            {next !== "/entry" ? (
              <p className="fn-entry-tos-note">ログイン後、初期設定を経て元のページへ戻ります。</p>
            ) : null}
          </div>
        </section>
      ) : !onboarding.isComplete ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h2 className="fn-jp fn-panel-title">初期設定が未完了です</h2>
            <p className="fn-jp fn-entry-status-lead">
              利用規約への同意と X ID 連携を済ませると、投稿・枠確保が使えます。
            </p>
            <Link href={onboardingNext} className="fn-btn fn-btn-primary fn-mt-12">
              初期設定を続ける
            </Link>
          </div>
        </div>
      ) : !canPost ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name="clock" size={18} aria-hidden />
          <div>
            <h2 className="fn-jp fn-panel-title">X ID 承認待ち</h2>
            <p className="fn-jp fn-entry-status-lead">
              枠確保は可能です。投稿は X ID 承認後に利用できます。
            </p>
            <Link href={onboardingNext} className="fn-btn fn-btn-ghost fn-btn-sm fn-mt-12">
              初期設定を確認
            </Link>
          </div>
        </div>
      ) : (
        <div className="fn-entry-status fn-entry-status--ok">
          <Icon name="check" size={14} aria-hidden className="fn-text-ok" />
          <span className="fn-jp">
            投稿可能
            {sessionUser?.active_x_user_id
              ? ` · @${sessionUser.active_x_user_id}`
              : ""}
          </span>
          <Link
            href={`/dashboard/settings?next=${encodeURIComponent("/entry")}`}
            className="fn-link fn-entry-status-actions"
          >
            名義を切替
          </Link>
        </div>
      )}

      <div className={`fn-entry-grid ${styles.choiceGrid}`}>
        <section
          className={`fn-entry-card ${styles.choiceCard}`}
          aria-labelledby="join-event-card"
        >
          <h2 id="join-event-card" className={styles.cardTitle}>
            <Icon name="calendar" size={16} aria-hidden />
            イベントに参加する
          </h2>
          <p className={styles.cardLead}>
            開催中のイベントの枠を確保して、作品を投稿できます。
          </p>
          <ol className={styles.flowSteps} aria-label="投稿の流れ">
            <li>枠を確保</li>
            <li>作品情報を登録</li>
            <li>YouTube URL を登録</li>
          </ol>
          {displaySlots.length > 0 ? (
            <div className={`${styles.slotPanel} ${styles.slotPanelProminent}`} aria-labelledby="post-slotted-card">
              <div className={styles.slotPanelHeader}>
                <h3 id="post-slotted-card" className={styles.slotPanelTitle}>
                  <Icon name="check" size={14} aria-hidden />
                  確保済み枠に提出する
                </h3>
                <span className={styles.slotPanelCount}>{displaySlots.length}件</span>
              </div>
              <p className={styles.slotPanelLead}>
                未提出の枠から先に表示しています。連続枠は1つの提出として扱います。
              </p>
              <ul className="fn-pc-slot-list">
                {displaySlots.map((slot) => {
                  const needsSubmission = !slot.video_id && slot.status === "reserved";
                  const slotHref = resolveWriteHref(`/entry/slotted?slot=${slot.id}`);
                  return (
                    <li key={slot.id}>
                      <div className={styles.slotRow}>
                        <Link href={slotHref} className="fn-pc-slot">
                          <span className="fn-pc-slot-info">
                            <span className="fn-pc-slot-label">{slot.event_title ?? slot.event_id}</span>
                            <span className="fn-mono fn-pc-slot-event">
                              {slot.start_time
                                ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`
                                : (slot.slot_label ?? "時間なし枠")}
                              {slot.is_group ? ` / ${slot.group_size}連続` : ""}
                            </span>
                            {slot.event_entry_end_time != null ? (
                              <span className={styles.slotDeadline}>
                                提出期限: {formatUnix(slot.event_entry_end_time)}
                              </span>
                            ) : null}
                          </span>
                          {!needsSubmission ? <Icon name="chevron-right" size={13} aria-hidden /> : null}
                        </Link>
                        {needsSubmission ? (
                          <Link href={slotHref} className="fn-btn fn-btn-primary fn-btn-sm">
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
              activeEvents.map((ev) => (
                <Link
                  key={ev.id}
                  href={resolveWriteHref(`/event/${ev.id}/slots`)}
                  className={styles.eventCard}
                  style={
                    ev.accent_color
                      ? ({
                          ["--event-accent" as never]: ev.accent_color,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className={styles.eventCardTitle}>{ev.title}</span>
                  <span className={styles.eventCardMeta}>
                    残り {slotCounts.get(ev.id) ?? 0} 枠
                    {ev.explanation ? ` / ${ev.explanation.slice(0, 60)}` : ""}
                  </span>
                  <span className={styles.eventCardMeta}>
                    {formatUnix(ev.start_time, { dateOnly: true })}
                    {ev.end_time
                      ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                      : ""}
                    {isAcceptingEntries(ev) ? " · 受付中" : ""}
                  </span>
                  {ev.entry_end_time != null ? (
                    <span className={styles.eventCardMeta}>
                      募集終了: {formatUnix(ev.entry_end_time)}
                    </span>
                  ) : null}
                </Link>
              ))
            )}
          </div>
          {isLoggedIn && activeEvents.length === 1 ? (
            <div className={`${styles.btnRow} fn-mt-12`}>
              <Link
                href={resolveWriteHref(`/event/${activeEvents[0].id}/slots`)}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="calendar" size={14} aria-hidden />
                {writeCtaLabel("枠を確保する")}
              </Link>
            </div>
          ) : isLoggedIn && activeEvents.length > 1 ? (
            <p className="fn-text-muted-sm fn-mt-12">
              参加するイベントを上の一覧から選択してください (募集終了が近い順)。
            </p>
          ) : activeEvents.length === 0 ? (
            <div className={`${styles.btnRow} fn-mt-12`}>
              <Link href="/event" className="fn-btn fn-btn-ghost">
                <Icon name="calendar" size={14} aria-hidden />
                イベント一覧を見る
              </Link>
            </div>
          ) : null}

        </section>

        <section
          className={`fn-entry-card ${styles.choiceCard}`}
          aria-labelledby="post-unslotted-card"
        >
          <h2 id="post-unslotted-card" className={styles.cardTitle}>
            <Icon name="edit" size={16} aria-hidden />
            過去の自分の作品を投稿する
          </h2>
          <p className={styles.cardLead}>
            イベントの枠に関係なく、既存の作品をFlameNodeに登録できます。
            投稿には承認済みのX IDが必要です。
          </p>
          <ol className={styles.flowSteps} aria-label="投稿の流れ">
            <li>作品情報を登録</li>
            <li>YouTube URL を登録</li>
          </ol>
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
