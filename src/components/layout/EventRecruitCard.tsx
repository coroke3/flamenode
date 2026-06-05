import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { events as eventsTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";
import styles from "./EventRecruitCard.module.css";

type EventRow = typeof eventsTable.$inferSelect;

interface EventRecruitCardProps {
  event: EventRow;
  available: number | null;
  total: number | null;
  variant?: "primary" | "compact";
}

type RecruitState =
  | "before_entry"
  | "accepting"
  | "after_entry"
  | "soon"
  | "ongoing"
  | "ended"
  | "full";

interface TimelineRange {
  left: number;
  width: number;
}

interface TimelinePoint {
  label: string;
  time: number;
  position: number;
  emphasis?: boolean;
}

interface TimelineModel {
  entryRange: TimelineRange | null;
  postRange: TimelineRange | null;
  nowPosition: number;
  points: TimelinePoint[];
}

function stateLabel(state: RecruitState): string {
  switch (state) {
    case "before_entry":
      return "募集開始前";
    case "accepting":
      return "募集期間中";
    case "after_entry":
      return "公開前作品受付中";
    case "soon":
      return "近日公開";
    case "ongoing":
      return "開催中";
    case "ended":
      return "終了";
    case "full":
      return "満枠";
  }
}

function resolveState(
  event: EventRow,
  available: number | null,
  now: number,
): RecruitState {
  const status = computeEventStatus(event, now);
  if (status === "archived" || status === "ended") return "ended";
  if (isAcceptingEntries(event, now)) {
    if (available != null && available === 0) return "full";
    return "accepting";
  }

  const eventPoint = event.start_time ?? event.end_time;
  if (
    event.entry_end_time != null &&
    now > event.entry_end_time &&
    eventPoint != null
  ) {
    const daysToStart = (eventPoint - now) / 86400;
    return daysToStart <= 3 ? "soon" : "after_entry";
  }
  if (status === "active") return "ongoing";
  if (event.entry_start_time != null && now < event.entry_start_time) {
    return "before_entry";
  }
  return "before_entry";
}

function formatRemaining(seconds: number | null): {
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
        label: "公開まで",
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
        href: `/event/${event.id}/slots`,
        label: "枠を確保する",
        iconName: "calendar",
      };
    case "after_entry":
      return {
        href: `/dashboard/post?event=${encodeURIComponent(event.id)}`,
        label: "作品を投稿する",
        iconName: "edit",
      };
    case "before_entry":
    case "soon":
    case "ongoing":
    case "ended":
    case "full":
      return {
        href: `/event/${event.id}`,
        label: "イベント詳細を見る",
        iconName: "chevron-right",
      };
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function rangeFromTimes(
  start: number | null,
  end: number | null,
  min: number,
  duration: number,
): TimelineRange | null {
  if (start == null || end == null || duration <= 0 || end <= start) return null;
  const left = clampPercent(((start - min) / duration) * 100);
  const right = clampPercent(((end - min) / duration) * 100);
  return { left, width: Math.max(1, right - left) };
}

function buildTimeline(event: EventRow, now: number): TimelineModel | null {
  const timelineTimes = [
    event.entry_start_time,
    event.entry_end_time,
    event.start_time,
    event.end_time,
    now,
  ].filter((value): value is number => value != null);
  if (timelineTimes.length < 2) return null;

  const min = Math.min(...timelineTimes);
  const max = Math.max(...timelineTimes);
  const duration = max - min;
  if (duration <= 0) return null;

  const position = (time: number) => clampPercent(((time - min) / duration) * 100);
  const points: TimelinePoint[] = [
    event.entry_start_time != null
      ? {
          label: "募集開始",
          time: event.entry_start_time,
          position: position(event.entry_start_time),
        }
      : null,
    event.entry_end_time != null
      ? {
          label: "募集締切",
          time: event.entry_end_time,
          position: position(event.entry_end_time),
          emphasis: true,
        }
      : null,
    event.start_time != null
      ? {
          label: "公開",
          time: event.start_time,
          position: position(event.start_time),
          emphasis: true,
        }
      : null,
    event.end_time != null
      ? {
          label: "終了",
          time: event.end_time,
          position: position(event.end_time),
        }
      : null,
  ].filter((point): point is TimelinePoint => point != null);

  return {
    entryRange: rangeFromTimes(
      event.entry_start_time,
      event.entry_end_time,
      min,
      duration,
    ),
    postRange: rangeFromTimes(event.entry_end_time, event.start_time, min, duration),
    nowPosition: position(now),
    points,
  };
}

function stateBadgeClass(
  state: RecruitState,
  classMap: Record<string, string>,
): string {
  switch (state) {
    case "accepting":
      return classMap.stateBadgeAccept ?? "";
    case "after_entry":
      return classMap.stateBadgePost ?? "";
    case "soon":
      return classMap.stateBadgeSoon ?? "";
    case "full":
      return classMap.stateBadgeFull ?? "";
    case "ended":
      return classMap.stateBadgeEnded ?? "";
    case "before_entry":
      return classMap.stateBadgeBefore ?? "";
    case "ongoing":
      return classMap.stateBadgeOngoing ?? "";
  }
}

export function EventRecruitCard({
  event,
  available,
  total,
  variant = "primary",
}: EventRecruitCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const state = resolveState(event, available, now);
  const countdown = resolveCountdown(event, state, now);
  const countdownDisplay = formatRemaining(countdown.seconds);
  const cta = resolveCta(event, state);
  const timeline = buildTimeline(event, now);
  const slotsFull = available != null && available <= 0;
  const slotsLow = available != null && available > 0 && available <= 3;
  const filledSlots =
    available != null && total != null && total > 0
      ? Math.max(0, total - available)
      : null;
  const fillRatio =
    filledSlots != null && total != null && total > 0
      ? Math.min(100, Math.round((filledSlots / total) * 100))
      : null;
  const accentStyle = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;
  const titleLabel = variant === "primary" ? stateLabel(state) : event.title;
  const badgeLabel = variant === "primary" ? event.title : stateLabel(state);

  return (
    <article
      className={[
        variant === "primary" ? "fn-rec" : "",
        styles.card,
        variant === "compact" ? styles.cardCompact : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={accentStyle}
      data-kind={
        state === "accepting" || state === "after_entry"
          ? "entry"
          : state === "before_entry"
            ? "pre"
            : state === "ended"
              ? "ended"
              : "submit"
      }
    >
      <div className={styles.left}>
        <header className={styles.header}>
          <span className={variant === "primary" ? "fn-rec-code" : styles.eyebrow}>
            {event.id.slice(0, 8).toUpperCase()}
          </span>
          {variant === "primary" ? (
            <p className="fn-rec-status">{stateLabel(state)}</p>
          ) : null}
          <Link href={`/event/${event.id}`} className={styles.title}>
            {variant === "primary" ? event.title : titleLabel}
          </Link>
          {variant !== "primary" ? (
            <span
              className={`${styles.stateBadge} ${stateBadgeClass(state, styles)}`}
            >
              {badgeLabel}
            </span>
          ) : null}
        </header>

        {timeline ? (
          <div className={styles.timeline} aria-hidden>
            <div className={styles.timelineTrack}>
              {timeline.entryRange ? (
                <span
                  className={styles.timelineEntryRange}
                  style={{
                    left: `${timeline.entryRange.left}%`,
                    width: `${timeline.entryRange.width}%`,
                  }}
                />
              ) : null}
              {timeline.postRange ? (
                <span
                  className={styles.timelinePostRange}
                  style={{
                    left: `${timeline.postRange.left}%`,
                    width: `${timeline.postRange.width}%`,
                  }}
                />
              ) : null}
              {timeline.points.map((point) => (
                <span
                  key={`${point.label}-${point.time}`}
                  className={`${styles.timelineMilestone} ${
                    point.emphasis ? styles.timelineMilestoneEmph : ""
                  }`}
                  style={{ left: `${point.position}%` }}
                />
              ))}
              <span
                className={styles.timelineNow}
                style={{ left: `${timeline.nowPosition}%` }}
              />
            </div>
            <div className={styles.timelineLabels}>
              {timeline.points.map((point, index) => (
                <span
                  key={`${point.label}-${point.time}-label`}
                  className={`${styles.timelineLabel} ${
                    index % 2 === 1 ? styles.timelineLabelStagger : ""
                  }`}
                  style={{ left: `${point.position}%` }}
                >
                  <span className={styles.timelineLabelName}>{point.label}</span>
                  <span className={styles.timelineLabelDate}>
                    {formatUnix(point.time, { dateOnly: true })}
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
                {formatUnix(event.entry_start_time, { dateOnly: true })} -{" "}
                {formatUnix(event.entry_end_time, { dateOnly: true })}
              </dd>
            </div>
          ) : null}
          {event.entry_end_time != null && event.start_time != null ? (
            <div className={styles.periodItem}>
              <dt>公開前作品</dt>
              <dd>
                {formatUnix(event.entry_end_time, { dateOnly: true })} -{" "}
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
        <div className={styles.countdown}>
          <span className={styles.countdownLabel}>{countdown.label}</span>
          {countdownDisplay ? (
            <div className={styles.countdownValueWrap}>
              <span className={styles.countdownValue}>
                {countdownDisplay.value}
              </span>
              <span className={styles.countdownUnit}>
                {countdownDisplay.unit}
              </span>
            </div>
          ) : null}
        </div>

        <div
          className={`${styles.slots} ${slotsFull ? styles.slotsFull : ""} ${
            slotsLow && !slotsFull ? styles.slotsLow : ""
          }`}
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
              <span className={styles.slotsUnit}>未集計</span>
            </span>
          )}
          {slotsFull ? (
            <span className={styles.slotsHint}>満枠です</span>
          ) : slotsLow ? (
            <span className={styles.slotsHint}>残りわずか</span>
          ) : null}
          {fillRatio != null && filledSlots != null && total != null ? (
            <div
              className={styles.slotGauge}
              aria-label={`参加枠 ${filledSlots} / ${total}`}
            >
              <span className={styles.slotGaugeTrack}>
                <span
                  className={styles.slotGaugeFill}
                  style={{ width: `${fillRatio}%` }}
                />
              </span>
              <span className={styles.slotGaugeText}>
                参加枠 {filledSlots} / {total}・{fillRatio}% 埋まり
              </span>
            </div>
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
