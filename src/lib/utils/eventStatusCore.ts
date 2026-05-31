/**
 * Event display state helpers shared by public UI and admin views.
 */

export type EventDisplayStatus =
  | "draft"
  | "published"
  | "scheduled"
  | "active"
  | "ended"
  | "archived";

export interface EventStatusInput {
  is_active: number | null;
  is_archived: number | null;
  is_entry_open?: number | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
}

export function getEffectiveEventEnd(ev: EventStatusInput): number | null {
  if (ev.end_time != null) return ev.end_time;
  if (ev.start_time != null) return ev.start_time;
  return null;
}

export function getEffectiveEventStart(ev: EventStatusInput): number | null {
  if (ev.start_time != null) return ev.start_time;
  if (ev.end_time != null) return ev.end_time;
  return null;
}

export function computeEventStatus(
  ev: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): EventDisplayStatus {
  if (ev.is_archived === 1) return "archived";
  if (ev.is_active !== 1) return "draft";

  const effectiveEnd = getEffectiveEventEnd(ev);
  if (effectiveEnd != null && effectiveEnd <= now) return "ended";

  const effectiveStart = getEffectiveEventStart(ev);
  if (effectiveStart != null && effectiveStart > now) return "scheduled";
  if (effectiveStart != null && effectiveEnd != null) return "active";

  return "published";
}

export function eventStatusLabel(s: EventDisplayStatus): string {
  switch (s) {
    case "draft":
      return "下書き";
    case "published":
      return "公開";
    case "scheduled":
      return "開始前";
    case "active":
      return "開催中";
    case "ended":
      return "終了済";
    case "archived":
      return "アーカイブ";
  }
}

export function eventStatusBadgeClass(s: EventDisplayStatus): string {
  switch (s) {
    case "active":
    case "published":
      return "fn-badge-accent";
    case "scheduled":
      return "fn-badge-warning";
    case "ended":
    case "archived":
      return "fn-badge-neutral";
    case "draft":
      return "fn-badge-soft";
  }
}

export function isAcceptingEntries(
  ev: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const status = computeEventStatus(ev, now);
  if (
    !(
      ev.is_entry_open === 1 &&
      (status === "active" || status === "scheduled" || status === "published")
    )
  ) {
    return false;
  }
  if (ev.entry_start_time != null && now < ev.entry_start_time) return false;
  if (ev.entry_end_time != null && now > ev.entry_end_time) return false;
  return true;
}
