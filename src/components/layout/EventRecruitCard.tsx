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

interface TimelinePoint {
  name: string;
  time: number;
  pos: number;
  emphasized?: boolean;
}

function stateLabel(state: RecruitState): string {
  switch (state) {
    case "before_entry":
      return "募集開始前";
    case "accepting":
      return "エントリー受付中";
    case "after_entry":
      return "投稿期間中";
    case "soon":
      return "開催間近";
    case "ongoing":
      return "開催中";
    case "ended":
      return "終了";
    case "full":
      return "満枠";
  }
}

function ctaLabel(state: RecruitState, fallback: string): string {
  if (state === "accepting") return "枠を確保する";
  if (state === "after_entry") return "作品を投稿する";
  return fallback;
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
        href: `/event/${event.id}/slots`,
        label: "枠を確保する",
        iconName: "calendar",
      };
    case "after_entry":
      return {
        href: `/event/${event.id}`,
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

function buildTimeline(event: EventRow, now: number): {
  milestones: TimelinePoint[];
  entryRange?: { left: number; width: number };
  postRange?: { left: number; width: number };
  nowPos?: number;
} {
  const rawPoints: Array<{ name: string; time: number; emphasized?: boolean }> =
    [];
  if (event.entry_start_time != null) {
    rawPoints.push({ name: "募集開始", time: event.entry_start_time });
  }
  if (event.entry_end_time != null) {
    rawPoints.push({
      name: "募集終了",
      time: event.entry_end_time,
      emphasized: true,
    });
  }
  if (event.start_time != null) {
    rawPoints.push({ name: "開催", time: event.start_time, emphasized: true });
  }
  if (event.end_time != null && event.end_time !== event.start_time) {
    rawPoints.push({ name: "終了", time: event.end_time });
  }

  const merged = new Map<
    number,
    { names: string[]; emphasized: boolean; time: number }
  >();
  for (const point of rawPoints) {
    const existing = merged.get(point.time);
    if (existing) {
      existing.names.push(point.name);
      existing.emphasized = existing.emphasized || !!point.emphasized;
    } else {
      merged.set(point.time, {
        names: [point.name],
        emphasized: !!point.emphasized,
        time: point.time,
      });
    }
  }

  const points = Array.from(merged.values()).sort((a, b) => a.time - b.time);
  if (points.length < 2) return { milestones: [] };

  const min = points[0].time;
  const max = points[points.length - 1].time;
  const span = Math.max(1, max - min);
  const toPos = (time: number) =>
    Math.max(0, Math.min(100, ((time - min) / span) * 100));

  const milestones = points.map((point) => ({
    name: point.names.join(" / "),
    time: point.time,
    pos: toPos(point.time),
    emphasized: point.emphasized,
  }));

  const entryRange =
    event.entry_start_time != null && event.entry_end_time != null
      ? {
          left: toPos(event.entry_start_time),
          width: Math.max(
            1,
            toPos(event.entry_end_time) - toPos(event.entry_start_time),
          ),
        }
      : undefined;
  const postRange =
    event.entry_end_time != null && event.start_time != null
      ? {
          left: toPos(event.entry_end_time),
          width: Math.max(1, toPos(event.start_time) - toPos(event.entry_end_time)),
        }
      : undefined;
  const nowPos = now >= min && now <= max ? toPos(now) : undefined;

  return { milestones, entryRange, postRange, nowPos };
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
  const countdownDisplay = formatRemainingForHero(countdown.seconds);
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

  return (
    <article
      className={[
        styles.card,
        variant === "compact" ? styles.cardCompact : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={accentStyle}
    >
      <div className={styles.glow} aria-hidden />
      <div className={styles.left}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>FlameNode Event</span>
          <Link href={`/event/${event.id}`} className={styles.title}>
            {event.title}
          </Link>
          <span
            className={`${styles.stateBadge} ${stateBadgeClass(state, styles)}`}
          >
            {stateLabel(state)}
          </span>
        </header>

        {timeline.milestones.length > 0 ? (
          <div className={styles.timeline} aria-label="イベントの進行">
            <div className={styles.timelineTrack}>
              {timeline.entryRange ? (
                <span
                  className={styles.timelineEntryRange}
                  style={{
                    left: `${timeline.entryRange.left}%`,
                    width: `${timeline.entryRange.width}%`,
                  }}
                  aria-hidden
                />
              ) : null}
              {timeline.postRange ? (
                <span
                  className={styles.timelinePostRange}
                  style={{
                    left: `${timeline.postRange.left}%`,
                    width: `${timeline.postRange.width}%`,
                  }}
                  aria-hidden
                />
              ) : null}
              {timeline.milestones.map((point) => (
                <span
                  key={`${point.name}-${point.time}`}
                  className={`${styles.timelineMilestone} ${
                    point.emphasized ? styles.timelineMilestoneEmph : ""
                  }`}
                  style={{ left: `${point.pos}%` }}
                  aria-hidden
                />
              ))}
              {timeline.nowPos != null ? (
                <span
                  className={styles.timelineNow}
                  style={{ left: `${timeline.nowPos}%` }}
                  aria-hidden
                />
              ) : null}
            </div>
            <div className={styles.timelineLabels} aria-hidden>
              {timeline.milestones.map((point) => (
                <span
                  key={`label-${point.name}-${point.time}`}
                  className={styles.timelineLabel}
                  style={{ left: `${point.pos}%` }}
                >
                  <span className={styles.timelineLabelName}>{point.name}</span>
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
              <dt>投稿期間</dt>
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
          {ctaLabel(state, cta.label)}
        </Link>
      </aside>
    </article>
  );
}
