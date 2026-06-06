import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { events as eventsTable } from "@/lib/db/schema";
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

interface TimelineModel {
  startMonthLabel: string;
  midMonthLabel: string;
  endMonthLabel: string;
  markerLabel: string;
  markerPct: number;
  windowLeftPct: number;
  windowWidthPct: number;
}

const DAY_SECONDS = 86400;
const JST = { timeZone: "Asia/Tokyo" } as const;
const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  ...JST,
  month: "numeric",
});
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  ...JST,
  month: "numeric",
  day: "numeric",
});

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
    return available === 0 ? "full" : "accepting";
  }
  if (status === "active") return "ongoing";

  const eventPoint = event.start_time ?? event.end_time;
  if (event.entry_end_time != null && now > event.entry_end_time && eventPoint) {
    return (eventPoint - now) / DAY_SECONDS <= 3 ? "soon" : "after_entry";
  }
  return "before_entry";
}

function resolveCountdown(
  event: EventRow,
  now: number,
): { heading: string; label: string; seconds: number | null; range: string } {
  const postRange = formatRange(event.start_time, event.end_time);
  if (event.start_time != null && event.start_time > now) {
    return {
      heading: "投稿期間",
      label: "投稿期間まで",
      seconds: event.start_time - now,
      range: postRange,
    };
  }
  if (event.end_time != null && event.end_time > now) {
    return {
      heading: "投稿期間",
      label: "投稿期間終了まで",
      seconds: event.end_time - now,
      range: postRange,
    };
  }
  if (event.entry_end_time != null && event.entry_end_time > now) {
    return {
      heading: "募集期間",
      label: "募集締切まで",
      seconds: event.entry_end_time - now,
      range: formatRange(event.entry_start_time, event.entry_end_time),
    };
  }
  if (event.entry_start_time != null && event.entry_start_time > now) {
    return {
      heading: "募集期間",
      label: "募集開始まで",
      seconds: event.entry_start_time - now,
      range: formatRange(event.entry_start_time, event.entry_end_time),
    };
  }
  return {
    heading: "投稿期間",
    label: "終了済み",
    seconds: null,
    range: postRange,
  };
}

function formatRemaining(seconds: number | null): {
  value: string;
  unit: string;
} | null {
  if (seconds == null) return null;
  if (seconds <= 0) return { value: "0", unit: "日" };
  const days = Math.ceil(seconds / DAY_SECONDS);
  if (days >= 1) return { value: String(days), unit: "日" };
  const hours = Math.max(1, Math.ceil(seconds / 3600));
  return { value: String(hours), unit: "時間" };
}

function buildTimeline(event: EventRow, now: number): TimelineModel {
  const start =
    event.entry_start_time ??
    event.start_time ??
    event.created_at ??
    now - DAY_SECONDS * 14;
  const end =
    event.end_time ??
    event.entry_end_time ??
    event.start_time ??
    start + DAY_SECONDS * 60;
  const safeEnd = end > start ? end : start + DAY_SECONDS * 60;
  const duration = safeEnd - start;
  const mid = start + duration / 2;
  const windowStart = event.start_time ?? event.entry_end_time ?? start;
  const windowEnd =
    event.end_time ??
    (event.start_time != null ? event.start_time + DAY_SECONDS : safeEnd);
  const windowLeftPct = clampPercent(((windowStart - start) / duration) * 100);
  const windowRightPct = clampPercent(((windowEnd - start) / duration) * 100);

  return {
    startMonthLabel: monthLabel(start),
    midMonthLabel: monthLabel(mid),
    endMonthLabel: monthLabel(safeEnd),
    markerLabel: compactDate(now),
    markerPct: clampPercent(((now - start) / duration) * 100),
    windowLeftPct,
    windowWidthPct: Math.max(2, windowRightPct - windowLeftPct),
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function monthLabel(ts: number): string {
  return monthFormatter.format(new Date(ts * 1000));
}

function compactDate(ts: number): string {
  return dateFormatter.format(new Date(ts * 1000));
}

function formatRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  const s = start != null ? compactDate(start) : "-";
  const e = end != null ? compactDate(end) : "-";
  return `${s} - ${e}`;
}

export function EventRecruitCard({
  event,
  available,
  total,
  variant = "primary",
}: EventRecruitCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const state = resolveState(event, available, now);
  const statusTitle = stateLabel(state);
  const countdown = resolveCountdown(event, now);
  const countdownDisplay = formatRemaining(countdown.seconds);
  const timeline = buildTimeline(event, now);
  const remaining = available ?? null;
  const slotTotal = total ?? null;
  const usedRatio =
    remaining != null && slotTotal != null && slotTotal > 0
      ? clampPercent(((slotTotal - remaining) / slotTotal) * 100)
      : 0;
  const accentStyle = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;

  return (
    <article
      className={`${styles.card} ${
        variant === "compact" ? styles.cardCompact : ""
      }`}
      style={accentStyle}
      aria-label={`${event.title} ${statusTitle}`}
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <p className={styles.code}>{event.id.toUpperCase()}</p>
          <Link href={`/event/${event.id}`} className={styles.statusTitle}>
            {statusTitle}
          </Link>

          <div className={styles.ruler} aria-hidden>
            <div className={styles.months}>
              <span>{timeline.startMonthLabel}</span>
              <span>{timeline.midMonthLabel}</span>
              <span>{timeline.endMonthLabel}</span>
            </div>
            <div className={styles.rulerLine}>
              <span
                className={styles.rulerWindow}
                style={{
                  left: `${timeline.windowLeftPct}%`,
                  width: `${timeline.windowWidthPct}%`,
                }}
              />
              <Icon
                name="chevron-right"
                size={18}
                className={styles.rulerArrow}
                aria-hidden
              />
              <span
                className={styles.rulerMarker}
                style={{ left: `${timeline.markerPct}%` }}
              >
                <span>{timeline.markerLabel}</span>
              </span>
            </div>
          </div>
        </div>

        <aside className={styles.side}>
          <Link href={`/event/${event.id}`} className={styles.cta}>
            詳細ページへ
            <Icon name="chevron-right" size={14} aria-hidden />
          </Link>
          <div className={styles.countdown}>
            <div className={styles.countdownHead}>
              <span>{countdown.heading}</span>
              <span>{countdown.range}</span>
            </div>
            {countdownDisplay ? (
              <div className={styles.countdownValueWrap}>
                <strong>{countdownDisplay.value}</strong>
                <span>{countdownDisplay.unit}</span>
              </div>
            ) : null}
            <p>{countdown.label}</p>
          </div>
        </aside>
      </div>

      <div className={styles.slots}>
        <span className={styles.slotsLabel}>残り枠</span>
        <strong>
          {remaining ?? "-"}
          {slotTotal != null ? <small>/{slotTotal}</small> : null}
        </strong>
        <span className={styles.slotGauge} aria-hidden>
          <span style={{ width: `${usedRatio}%` }} />
        </span>
      </div>
    </article>
  );
}
