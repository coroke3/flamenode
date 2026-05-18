import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { events as eventsTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import styles from "./EventRecruitCard.module.css";

type EventRow = typeof eventsTable.$inferSelect;

interface EventRecruitCardProps {
  event: EventRow;
  /** event_id に紐づく available スロット件数。null は未取得 / 未対応。 */
  available: number | null;
  /** event_id に紐づくスロット総数。null は未取得 / 未対応。 */
  total: number | null;
}

type RecruitState =
  | "before_entry"
  | "accepting"
  | "after_entry"
  | "soon"
  | "ongoing"
  | "ended"
  | "full";

const STATE_LABEL: Record<RecruitState, string> = {
  before_entry: "募集開始前",
  accepting: "募集期間中",
  after_entry: "投稿期間中",
  soon: "開催間近",
  ongoing: "開催中",
  ended: "受付終了",
  full: "満枠",
};

function resolveState(
  event: EventRow,
  available: number | null,
  now: number,
): RecruitState {
  if (event.is_archived === 1) return "ended";
  if (event.end_time != null && now > event.end_time) return "ended";
  if (event.start_time != null && now >= event.start_time) return "ongoing";
  if (
    event.entry_end_time != null &&
    now > event.entry_end_time &&
    event.start_time != null
  ) {
    const daysToStart = (event.start_time - now) / 86400;
    if (daysToStart <= 3) return "soon";
    return "after_entry";
  }
  if (
    event.is_entry_open === 1 &&
    (event.entry_start_time == null || now >= event.entry_start_time) &&
    (event.entry_end_time == null || now <= event.entry_end_time)
  ) {
    if (available != null && available === 0) return "full";
    return "accepting";
  }
  if (event.entry_start_time != null && now < event.entry_start_time) {
    return "before_entry";
  }
  return "accepting";
}

/** 残り秒数 -> { value, unit } の整形。日が 1 以上なら日単位、それ未満は時間。 */
function formatRemainingForHero(seconds: number | null): {
  value: string;
  unit: string;
} | null {
  if (seconds == null) return null;
  if (seconds <= 0) return { value: "0", unit: "分" };
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return { value: String(days), unit: "日" };
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return { value: String(hours), unit: "時間" };
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return { value: String(minutes), unit: "分" };
}

function resolveCountdown(
  event: EventRow,
  state: RecruitState,
  now: number,
): { label: string; seconds: number | null } {
  switch (state) {
    case "before_entry":
      return {
        label: "募集開始まで",
        seconds:
          event.entry_start_time != null ? event.entry_start_time - now : null,
      };
    case "accepting":
    case "full":
      return {
        label: "募集締切まで",
        seconds:
          event.entry_end_time != null ? event.entry_end_time - now : null,
      };
    case "after_entry":
    case "soon":
      return {
        label: "開催まで",
        seconds: event.start_time != null ? event.start_time - now : null,
      };
    case "ongoing":
      return {
        label: "終了まで",
        seconds: event.end_time != null ? event.end_time - now : null,
      };
    case "ended":
      return { label: "受付終了", seconds: null };
  }
}

function resolveCta(
  event: EventRow,
  state: RecruitState,
): { href: string; label: string; iconName: "calendar" | "edit" | "chevron-right" } {
  switch (state) {
    case "accepting":
      return {
        href: `/event/${event.id}#slot`,
        label: "参加する",
        iconName: "calendar",
      };
    case "after_entry":
      return {
        href: `/event/${event.id}`,
        label: "作品を投稿する",
        iconName: "edit",
      };
    case "before_entry":
      return {
        href: `/event/${event.id}`,
        label: "詳細ページへ",
        iconName: "chevron-right",
      };
    case "soon":
    case "ongoing":
    case "ended":
    case "full":
      return {
        href: `/event/${event.id}`,
        label: "詳細を見る",
        iconName: "chevron-right",
      };
  }
}

interface TimelinePoint {
  name: string;
  time: number;
  pos: number;
  emphasized?: boolean;
}

function buildTimeline(event: EventRow, now: number) {
  const points: Array<{ name: string; time: number; emphasized?: boolean }> = [];
  if (event.entry_start_time != null)
    points.push({ name: "募集開始", time: event.entry_start_time });
  if (event.entry_end_time != null)
    points.push({
      name: "募集終了",
      time: event.entry_end_time,
      emphasized: true,
    });
  if (event.start_time != null)
    points.push({ name: "開催", time: event.start_time, emphasized: true });
  if (event.end_time != null && event.end_time !== event.start_time)
    points.push({ name: "終了", time: event.end_time });

  if (points.length < 2) return null;

  // padding for visual breathing room: extend range by 5% before first / after last
  const min = Math.min(...points.map((p) => p.time));
  const max = Math.max(...points.map((p) => p.time));
  const rawRange = max - min;
  if (rawRange <= 0) return null;
  const pad = rawRange * 0.05;
  const lo = min - pad;
  const hi = max + pad;
  const range = hi - lo;

  const milestones: TimelinePoint[] = points.map((p) => ({
    name: p.name,
    time: p.time,
    pos: ((p.time - lo) / range) * 100,
    emphasized: p.emphasized,
  }));

  const nowPos = Math.max(0, Math.min(100, ((now - lo) / range) * 100));

  // 募集期間 / 投稿期間のレンジを計算
  const entryRange =
    event.entry_start_time != null && event.entry_end_time != null
      ? {
          start: ((event.entry_start_time - lo) / range) * 100,
          end: ((event.entry_end_time - lo) / range) * 100,
        }
      : null;
  const postRange =
    event.entry_end_time != null && event.start_time != null
      ? {
          start: ((event.entry_end_time - lo) / range) * 100,
          end: ((event.start_time - lo) / range) * 100,
        }
      : null;

  return { milestones, nowPos, entryRange, postRange };
}

export function EventRecruitCard({
  event,
  available,
  total,
}: EventRecruitCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const state = resolveState(event, available, now);
  const countdown = resolveCountdown(event, state, now);
  const cta = resolveCta(event, state);
  const countdownDisplay = formatRemainingForHero(countdown.seconds);
  const timeline = buildTimeline(event, now);

  // 残り枠の警告レベル
  const slotsLow =
    available != null && total != null && total > 0 && available <= Math.max(3, Math.floor(total * 0.1));
  const slotsFull = available != null && available === 0;

  return (
    <article className={styles.card} aria-labelledby={`recruit-${event.id}-title`}>
      <div className={styles.glow} aria-hidden />

      <div className={styles.left}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>
            <Icon name="alert" size={11} aria-hidden />
            FlameNode Event
          </span>
          <Link
            id={`recruit-${event.id}-title`}
            href={`/event/${event.id}`}
            className={styles.title}
          >
            {event.title}
          </Link>
          <span
            className={`${styles.stateBadge} ${stateBadgeClass(state, styles)}`}
            data-state={state}
          >
            {STATE_LABEL[state]}
          </span>
        </header>

        {timeline ? (
          <div className={styles.timeline}>
            <div className={styles.timelineTrack} aria-hidden>
              {timeline.entryRange ? (
                <span
                  className={styles.timelineEntryRange}
                  style={{
                    left: `${timeline.entryRange.start}%`,
                    width: `${Math.max(0, timeline.entryRange.end - timeline.entryRange.start)}%`,
                  }}
                />
              ) : null}
              {timeline.postRange ? (
                <span
                  className={styles.timelinePostRange}
                  style={{
                    left: `${timeline.postRange.start}%`,
                    width: `${Math.max(0, timeline.postRange.end - timeline.postRange.start)}%`,
                  }}
                />
              ) : null}
              {timeline.milestones.map((m) => (
                <span
                  key={m.name}
                  className={`${styles.timelineMilestone} ${m.emphasized ? styles.timelineMilestoneEmph : ""}`}
                  style={{ left: `${m.pos}%` }}
                  title={`${m.name} ${formatUnix(m.time, { dateOnly: true })}`}
                />
              ))}
              <span
                className={styles.timelineNow}
                style={{ left: `${timeline.nowPos}%` }}
                aria-hidden
              />
            </div>
            <div className={styles.timelineLabels} aria-hidden>
              {timeline.milestones.map((m) => (
                <span
                  key={`label-${m.name}`}
                  className={styles.timelineLabel}
                  style={{ left: `${m.pos}%` }}
                >
                  <span className={styles.timelineLabelName}>{m.name}</span>
                  <span className={styles.timelineLabelDate}>
                    {formatUnix(m.time, { dateOnly: true })}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <dl className={styles.periods}>
          {event.entry_start_time != null && event.entry_end_time != null ? (
            <div className={styles.periodItem}>
              <dt>募集期間</dt>
              <dd>
                {formatUnix(event.entry_start_time, { dateOnly: true })} 〜{" "}
                {formatUnix(event.entry_end_time, { dateOnly: true })}
              </dd>
            </div>
          ) : null}
          {event.entry_end_time != null && event.start_time != null ? (
            <div className={styles.periodItem}>
              <dt>投稿期間</dt>
              <dd>
                {formatUnix(event.entry_end_time, { dateOnly: true })} 〜{" "}
                {formatUnix(event.start_time, { dateOnly: true })}
              </dd>
            </div>
          ) : null}
          {event.start_time != null ? (
            <div className={styles.periodItem}>
              <dt>開催日</dt>
              <dd>{formatUnix(event.start_time, { dateOnly: true })}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <aside className={styles.right}>
        {countdownDisplay ? (
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>{countdown.label}</span>
            <div className={styles.countdownValueWrap}>
              <span className={styles.countdownValue}>
                {countdownDisplay.value}
              </span>
              <span className={styles.countdownUnit}>
                {countdownDisplay.unit}
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>{countdown.label}</span>
          </div>
        )}

        <div
          className={`${styles.slots} ${slotsFull ? styles.slotsFull : ""} ${slotsLow && !slotsFull ? styles.slotsLow : ""}`}
        >
          <span className={styles.slotsLabel}>残り枠</span>
          {available != null ? (
            <span className={styles.slotsValueWrap}>
              <span className={styles.slotsValue}>{available}</span>
              {total != null ? (
                <span className={styles.slotsTotal}>/ {total}</span>
              ) : null}
              <span className={styles.slotsUnit}>枠</span>
            </span>
          ) : (
            <span className={styles.slotsValueWrap}>
              <span className={styles.slotsUnit}>—</span>
            </span>
          )}
          {slotsFull ? (
            <span className={styles.slotsHint}>満枠です</span>
          ) : slotsLow ? (
            <span className={styles.slotsHint}>残りわずか</span>
          ) : null}
        </div>

        <Link href={cta.href} className={styles.cta}>
          <Icon name={cta.iconName} size={14} aria-hidden />
          {cta.label}
        </Link>
      </aside>
    </article>
  );
}

function stateBadgeClass(
  s: RecruitState,
  styles: Record<string, string>,
): string {
  switch (s) {
    case "accepting":
      return styles.stateBadgeAccept ?? "";
    case "after_entry":
      return styles.stateBadgePost ?? "";
    case "soon":
      return styles.stateBadgeSoon ?? "";
    case "full":
      return styles.stateBadgeFull ?? "";
    case "ended":
      return styles.stateBadgeEnded ?? "";
    case "before_entry":
      return styles.stateBadgeBefore ?? "";
    case "ongoing":
      return styles.stateBadgeOngoing ?? "";
  }
}
