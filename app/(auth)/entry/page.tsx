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
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { sanitizeNextPath } from "#utils/next";
import { collapseReservationGroups, type SlotBase } from "@/lib/utils/slotGrouping";

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
  discord_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  priority_reclaim_until: number | null;
  priority_reclaim_video_id: string | null;
  updated_at: number;
  event_title: string | null;
};

export default async function EntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next, "/entry");
  // 失敗時は null として扱う。getCurrentUser は内部で auth().catch を行うため
  // ここで try/catch する必要はない。
  const sessionUser = await getCurrentUser();
  const isLoggedIn = !!sessionUser?.id;
  // 書き込みガードは is_tos_accepted !== 1 (および terms_reaccept_required === 1) で
  // tos_required / tos_reaccept_required を返す。ここでも同じ条件を見て CTA 出す。
  const needsTosAccept =
    !!sessionUser &&
    (sessionUser.is_tos_accepted !== 1 ||
      sessionUser.terms_reaccept_required === 1);

  /** 書き込み系 CTA: 未ログイン → entry、TOS 未同意 → rules、それ以外は本来先 */
  const resolveWriteHref = (target: string): string => {
    if (!isLoggedIn) {
      return `/entry?next=${encodeURIComponent(target)}`;
    }
    if (needsTosAccept) {
      return `/rules?next=${encodeURIComponent(target)}`;
    }
    return target;
  };

  const writeCtaLabel = (defaultLabel: string): string =>
    needsTosAccept ? "利用規約に同意して進む" : defaultLabel;

  const db = getDatabase();
  const activeX = sessionUser?.active_x_user_id ?? null;
  const activeEventsRaw = db ? await fetchActiveEvents(db).catch(() => []) : [];
  // 開催前でも募集期間内のイベントは募集対象にする。
  // 複数並走時の優先度: 募集終了が近いものを先頭に、未設定は最後尾に回し、その中で start_time 昇順。
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
  let activeXApprovalStatus: "approved" | "pending" | "rejected" | null = null;
  if (db && sessionUser?.id) {
    if (activeX) {
      const xRow = (
        await db
          .select({ approval_status: xUsersTable.approval_status })
          .from(xUsersTable)
          .where(eq(xUsersTable.id, activeX))
          .limit(1)
      )[0];
      activeXApprovalStatus = xRow?.approval_status ?? null;
    }

    const ownerWhere = activeX
      ? or(
          eq(slotsTable.x_user_id, activeX),
          and(isNull(slotsTable.x_user_id), eq(slotsTable.discord_user_id, sessionUser.id))!,
        )
      : eq(slotsTable.discord_user_id, sessionUser.id);
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
  const displaySlots = collapseReservationGroups(reservedSlots as SlotBase[]);
  const canPost = isLoggedIn && activeXApprovalStatus === "approved";
  const checkTitle = canPost ? "投稿前チェック" : "投稿には追加設定が必要です";
  const checkMessage = !activeX
    ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
    : activeXApprovalStatus === "pending"
      ? "選択中のActive X IDは承認待ちです。承認後に投稿できます (枠の確保は可能)。"
      : activeXApprovalStatus === "rejected"
        ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
        : activeXApprovalStatus === "approved"
          ? `投稿者X ID: @${activeX} (承認済) で投稿できます。`
          : "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。";

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
              参加・投稿にはログインが必要です。
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: next });
              }}
              className={styles.btnRow}
            >
              <button type="submit" className="fn-btn fn-btn-primary fn-btn-lg">
                <Icon name="discord" size={14} aria-hidden />
                Discord でログイン
              </button>
            </form>
            {next !== "/entry" ? (
              <p className="fn-entry-tos-note">ログイン後、元のページへ戻ります。</p>
            ) : null}
            <p className="fn-entry-tos-note">
              ログイン後、枠確保や投稿などの書き込み操作を行う前に、最新の{" "}
              <Link href="/rules">利用規約</Link>
              への同意をお願いする場合があります。
            </p>
          </div>
        </section>
      ) : needsTosAccept ? (
        <div className="fn-entry-status fn-entry-status--warn">
        <StatusPanel
          title={
            sessionUser?.terms_reaccept_required === 1
              ? "利用規約の再同意が必要です"
              : "利用規約への同意が必要です"
          }
          tone="warning"
          action={
            <Link
              href={`/rules?next=${encodeURIComponent(next)}`}
              className="fn-btn fn-btn-primary"
            >
              利用規約を確認する
            </Link>
          }
        >
          {sessionUser?.terms_reaccept_required === 1
            ? "利用規約の改訂がありました。書き込み操作の前に最新の規約に再同意してください。"
            : "書き込み操作 (枠確保・投稿・いいね等) の前に、最新の利用規約への同意が必要です。"}
        </StatusPanel>
        </div>
      ) : (
        <div className="fn-entry-status fn-entry-status--ok">
          <Icon name="check" size={14} aria-hidden className="fn-text-ok" />
          <span className="fn-jp">
            ログイン済み
            {sessionUser?.active_x_user_id
              ? ` · Active X ID: @${sessionUser.active_x_user_id}`
              : " · Active X ID未選択"}
          </span>
          <Link href="/dashboard/settings" className="fn-link fn-entry-status-actions">
            切替
          </Link>
        </div>
      )}

      {isLoggedIn && !needsTosAccept ? (
        <div
          className={`fn-pc-status-banner ${canPost ? "fn-pc-status-banner--ok" : ""}`}
          role="status"
        >
          <Icon name={canPost ? "check" : "alert"} size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">{checkTitle}</h3>
            <p className="fn-jp fn-pc-banner-lead">{checkMessage}</p>
            {!canPost ? (
              <Link
                href={`/dashboard/settings?next=${encodeURIComponent("/entry")}`}
                className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
              >
                X ID設定を確認
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`fn-entry-grid ${styles.choiceGrid}`}>
        {/* カード1: イベントに参加する */}
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
                枠を確保する
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

          {displaySlots.length > 0 ? (
            <div className={styles.slotPanel} aria-labelledby="post-slotted-card">
              <h3 id="post-slotted-card" className={styles.slotPanelTitle}>
                <Icon name="check" size={14} aria-hidden />
                確保済み枠に提出する
              </h3>
              <p className={styles.slotPanelLead}>
                予約済みのイベント枠に作品情報を紐付けます。連続枠も1つの提出として扱います。
              </p>
              <ul className="fn-pc-slot-list">
                {displaySlots.map((slot) => (
                  <li key={slot.id}>
                    <Link
                      href={resolveWriteHref(`/entry/slotted?slot=${slot.id}`)}
                      className="fn-pc-slot"
                    >
                      <span className="fn-pc-slot-info">
                        <span className="fn-pc-slot-label">
                          {slot.event_title ?? slot.event_id}
                        </span>
                        <span className="fn-mono fn-pc-slot-event">
                          {slot.start_time
                            ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`
                            : (slot.slot_label ?? "時間なし枠")}
                          {slot.is_group ? ` / ${slot.group_size}連続` : ""}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={13} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* カード2: 過去の作品を投稿する */}
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
