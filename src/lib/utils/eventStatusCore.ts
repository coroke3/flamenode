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

export type EventVisibilityStatus = "draft" | "private" | "public" | "archived";

export interface EventStatusInput {
  visibility_status?: EventVisibilityStatus | string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
}

export function getEventVisibility(ev: EventStatusInput): EventVisibilityStatus {
  if (
    ev.visibility_status === "draft" ||
    ev.visibility_status === "private" ||
    ev.visibility_status === "public" ||
    ev.visibility_status === "archived"
  ) {
    return ev.visibility_status;
  }
  return "draft";
}

/** 公開サイトの一覧・詳細に載せてよい visibility。 */
export const PUBLICLY_LISTABLE_EVENT_VISIBILITIES = [
  "public",
  "archived",
] as const satisfies readonly EventVisibilityStatus[];

export function isPubliclyListableEventVisibility(
  visibility: EventVisibilityStatus | string | null | undefined,
): boolean {
  return (
    visibility === "public" ||
    visibility === "archived"
  );
}

export function isPublicEventVisible(ev: EventStatusInput): boolean {
  return isPubliclyListableEventVisibility(getEventVisibility(ev));
}

export function isEventArchived(ev: EventStatusInput): boolean {
  return getEventVisibility(ev) === "archived";
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
  const visibility = getEventVisibility(ev);
  if (visibility === "archived") return "archived";
  if (visibility !== "public") return "draft";

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
  if (!(status === "active" || status === "scheduled" || status === "published")) {
    return false;
  }
  if (ev.entry_start_time == null && ev.entry_end_time == null) return false;
  if (ev.entry_start_time != null && now < ev.entry_start_time) return false;
  if (ev.entry_end_time != null && now > ev.entry_end_time) return false;
  return true;
}
