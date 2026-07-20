import * as React from "react";
import Link from "next/link";
import { buildAccentVars } from "@/lib/theme/accent";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";
import type { EventStatusInput } from "@/lib/utils/eventStatus";
import { formatRemainingTimeMetric } from "@/lib/utils/remainingTime";

export type RecruitEvent = EventStatusInput & {
  id: string;
  title: string;
  accent_color?: string | null;
  created_at?: number | null;
};

interface EventRecruitCardProps {
  event: RecruitEvent;
  available: number | null;
  total: number | null;
  variant?: "primary" | "compact";
  actionHref?: string;
  actionLabel?: string;
}

type RecruitState =
  | "before_entry"
  | "accepting"
  | "after_entry"
  | "soon"
  | "ongoing"
  | "ended"
  | "full";

type RecruitKind = "pre" | "entry" | "submit" | "ended";

interface TimelineModel {
  monthLabels: Array<{
    key: string;
    label: string;
    pct: number;
    align: "start" | "center" | "end";
  }>;
  markerLabel: string;
  markerPct: number;
  markerAlign: "start" | "center" | "end";
  windowLeftPct: number;
  windowWidthPct: number;
  entryLeftPct: number;
  entryWidthPct: number;
}

const DAY_SECONDS = 86400;
const JST = { timeZone: "Asia/Tokyo" } as const;
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

function toRecruitKind(state: RecruitState): RecruitKind {
  switch (state) {
    case "before_entry":
      return "pre";
    case "accepting":
    case "full":
      return "entry";
    case "after_entry":
    case "soon":
    case "ongoing":
      return "submit";
    case "ended":
      return "ended";
  }
}

function resolveState(
  event: RecruitEvent,
  available: number | null,
  now: number,
): RecruitState {
  const status = computeEventStatus(event, now);
  if (status === "ended" || status === "private") return "ended";
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
  event: RecruitEvent,
  now: number,
): { heading: string; seconds: number | null; range: string } {
  const postRange = formatRange(event.start_time, event.end_time);
  if (event.start_time != null && event.start_time > now) {
    return {
      heading: "投稿期間まで",
      seconds: event.start_time - now,
      range: postRange,
    };
  }
  if (event.end_time != null && event.end_time > now) {
    return {
      heading: "投稿期間終了まで",
      seconds: event.end_time - now,
      range: postRange,
    };
  }
  if (event.entry_end_time != null && event.entry_end_time > now) {
    return {
      heading: "募集締切まで",
      seconds: event.entry_end_time - now,
      range: formatRange(event.entry_start_time ?? null, event.entry_end_time),
    };
  }
  if (event.entry_start_time != null && event.entry_start_time > now) {
    return {
      heading: "募集開始まで",
      seconds: event.entry_start_time - now,
      range: formatRange(event.entry_start_time, event.entry_end_time ?? null),
    };
  }
  return {
    heading: "終了済み",
    seconds: null,
    range: postRange,
  };
}

function buildTimeline(
  event: RecruitEvent,
  now: number,
  state: RecruitState,
): TimelineModel {
  const fullStart =
    event.entry_start_time ??
    event.start_time ??
    event.created_at ??
    now - DAY_SECONDS * 14;
  const fullEnd =
    event.end_time ??
    event.entry_end_time ??
    event.start_time ??
    fullStart + DAY_SECONDS * 60;
  const safeFullEnd = fullEnd > fullStart ? fullEnd : fullStart + DAY_SECONDS * 60;

  const entryStart = event.entry_start_time ?? fullStart;
  const entryEnd = event.entry_end_time ?? entryStart + DAY_SECONDS * 7;
  const windowStart = event.start_time ?? entryEnd;
  const windowEnd =
    event.end_time ??
    (event.start_time != null ? event.start_time + DAY_SECONDS : safeFullEnd);

  let start: number;
  let end: number;

  if (state === "accepting" || state === "full") {
    start = fullStart;
    end = safeFullEnd;
  } else if (
    state === "after_entry" ||
    state === "soon" ||
    state === "ongoing"
  ) {
    const margin = DAY_SECONDS * 2;
    start = Math.min(entryStart, now) - margin;
    end = Math.max(windowEnd, now) + margin;
  } else {
    start = fullStart;
    end = safeFullEnd;
  }

  const safeEnd = end > start ? end : start + DAY_SECONDS * 1;
  const duration = safeEnd - start;
  const mid = start + duration / 2;

  const windowLeftPct = clampPercent(((windowStart - start) / duration) * 100);
  const windowRightPct = clampPercent(((windowEnd - start) / duration) * 100);
  const entryLeftPct = clampPercent(((entryStart - start) / duration) * 100);
  const entryRightPct = clampPercent(((entryEnd - start) / duration) * 100);

  const markerPct = clampPercent(((now - start) / duration) * 100);

  return {
    monthLabels: buildMonthLabels(start, mid, safeEnd),
    markerLabel: compactDate(now),
    markerPct,
    markerAlign: markerPct <= 8 ? "start" : markerPct >= 92 ? "end" : "center",
    windowLeftPct,
    windowWidthPct: Math.max(2, windowRightPct - windowLeftPct),
    entryLeftPct,
    entryWidthPct: Math.max(2, entryRightPct - entryLeftPct),
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compactDate(ts: number): string {
  return dateFormatter.format(new Date(ts * 1000));
}

function buildMonthLabels(
  start: number,
  mid: number,
  end: number,
): TimelineModel["monthLabels"] {
  const raw: TimelineModel["monthLabels"] = [
    { key: "start", label: compactDate(start), pct: 0, align: "start" },
    { key: "mid", label: compactDate(mid), pct: 50, align: "center" },
    { key: "end", label: compactDate(end), pct: 100, align: "end" },
  ];

  return raw.filter((item, index, items) => {
    const previousSameLabel = items
      .slice(0, index)
      .find((other) => other.label === item.label);
    return !previousSameLabel || Math.abs(item.pct - previousSameLabel.pct) >= 18;
  });
}

function formatRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  const s = start != null ? compactDate(start) : "-";
  const e = end != null ? compactDate(end) : "-";
  return `${s} — ${e}`;
}

function RecruitRuler({ timeline }: { timeline: TimelineModel }): React.ReactElement {
  const ticks = React.useMemo(() => {
    const list: Array<{ x: number; weekly: boolean; major: boolean }> = [];
    for (let i = 0; i <= 20; i++) {
      list.push({
        x: (i / 20) * 100,
        weekly: i % 5 === 0,
        major: i === 0 || i === 10 || i === 20,
      });
    }
    return list;
  }, []);

  return (
    <div className="fn-ruler" aria-hidden>
      <div
        className="fn-ruler-window"
        data-kind="submit"
        style={{
          left: `${timeline.windowLeftPct}%`,
          width: `${timeline.windowWidthPct}%`,
        }}
      />
      <div
        className="fn-ruler-window"
        data-kind="entry"
        style={{
          left: `${timeline.entryLeftPct}%`,
          width: `${timeline.entryWidthPct}%`,
        }}
      />
      <div className="fn-ruler-ticks">
        {ticks.map((tick, index) => (
          <span
            key={index}
            className="fn-ruler-tick"
            data-weekly={tick.weekly && !tick.major ? "" : undefined}
            data-major={tick.major ? "" : undefined}
            style={{ left: `${tick.x}%` }}
          />
        ))}
      </div>
      <div className="fn-ruler-labels">
        {timeline.monthLabels.map((label) => (
          <span
            key={label.key}
            className="fn-ruler-label fn-mono"
            data-align={label.align}
            style={{ left: `${label.pct}%` }}
          >
            {label.label}
          </span>
        ))}
        <span
          className="fn-ruler-label fn-mono"
          data-today=""
          data-align={timeline.markerAlign}
          style={{ left: `${timeline.markerPct}%` }}
        >
          {timeline.markerLabel}
        </span>
      </div>
      <div
        className="fn-ruler-today"
        style={{ left: `${timeline.markerPct}%` }}
      />
      <span className="fn-ruler-arrow" />
    </div>
  );
}

export function EventRecruitCard({
  event,
  available,
  total,
  variant: _variant = "primary",
  actionHref,
  actionLabel,
}: EventRecruitCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const state = resolveState(event, available, now);
  const kind = toRecruitKind(state);
  const statusTitle = stateLabel(state);
  const countdown = resolveCountdown(event, now);
  const countdownDisplay = formatRemainingTimeMetric(countdown.seconds);
  const timeline = buildTimeline(event, now, state);
  const slotTotal = total ?? null;
  const filledSlots =
    slotTotal != null && available != null
      ? Math.max(0, slotTotal - available)
      : null;
  const slotFillPct =
    slotTotal != null && slotTotal > 0 && filledSlots != null
      ? clampPercent((filledSlots / slotTotal) * 100)
      : 0;
  const ctaHref = actionHref ?? `/event/${event.id}`;
  const ctaLabel = actionLabel ?? "詳細ページへ";

  const accentStyle = event.accent_color
    ? ({
        ...buildAccentVars(event.accent_color, "dark"),
        "--rec-accent": "var(--event-accent)",
        "--rec-accent-strong": "var(--event-accent-strong)",
        "--rec-accent-soft": "var(--event-accent-soft)",
        "--rec-accent-ink": "var(--event-accent-text)",
        "--rec-ui-accent": "var(--event-accent)",
        "--rec-ui-accent-strong": "var(--event-accent-strong)",
        "--rec-ui-accent-soft": "var(--event-accent-soft)",
        "--rec-ui-ink": "var(--event-accent-text)",
      } as React.CSSProperties)
    : undefined;

  return (
    <article
      className="fn-rec"
      data-kind={kind}
      data-variant={_variant}
      style={accentStyle}
      aria-label={`${event.title} ${statusTitle}`}
    >
      <header className="fn-rec-head">
        <div className="fn-rec-title-row">
          <span className="fn-rec-code fn-mono">{event.id.toUpperCase()}</span>
          <Link href={`/event/${event.id}`} className="fn-rec-status fn-display">
            {statusTitle}
          </Link>
        </div>
        <Link
          href={ctaHref}
          className="fn-btn fn-btn-primary fn-rec-cta"
          data-variant="accent"
          data-size="lg"
        >
          <span>{ctaLabel}</span>
          <span className="fn-rec-cta-arrow" aria-hidden>
            →
          </span>
        </Link>
      </header>

      <div className="fn-rec-body">
        <RecruitRuler timeline={timeline} />
        <div className="fn-rec-info" data-kind={kind}>
          <div className="fn-rec-info-head">
            <span className="fn-rec-info-label">{countdown.heading}</span>
            <span className="fn-rec-info-range fn-mono">{countdown.range}</span>
          </div>
          {countdownDisplay ? (
            <div className="fn-rec-info-count">
              <span className="fn-rec-info-num fn-display">
                {countdownDisplay.value}
              </span>
              <span className="fn-rec-info-tail">
                <span className="fn-rec-info-unit">{countdownDisplay.unit}</span>
              </span>
            </div>
          ) : (
            <div className="fn-rec-info-count">
              <span className="fn-rec-info-num fn-display">—</span>
            </div>
          )}
        </div>
      </div>

      <footer className="fn-rec-foot">
        <span className="fn-rec-foot-cell fn-mono">
          <span className="fn-rec-foot-k">埋まり枠</span>
          <span className="fn-rec-foot-v">
            {filledSlots ?? "-"}
            {slotTotal != null ? (
              <span className="fn-rec-foot-tot">/{slotTotal}</span>
            ) : null}
          </span>
        </span>
        <span
          className="fn-rec-slot-gauge"
          aria-label={`埋まり枠 ${filledSlots ?? 0}/${slotTotal ?? 0}`}
        >
          <span style={{ width: `${slotFillPct}%` }} />
        </span>
      </footer>
    </article>
  );
}
