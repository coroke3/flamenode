/**
 * Event display state helpers shared by public UI and admin views.
 *
 * DB上の公開設定は private / public の2種類だけを正本とし、
 * 開催段階と募集段階は日時から算出する。
 */

export type EventDisplayStatus =
  | "private"
  | "published"
  | "scheduled"
  | "active"
  | "ended";

export type EventVisibilityStatus = "private" | "public";

export interface EventStatusInput {
  visibility_status?: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
}

export function getEventVisibility(ev: EventStatusInput): EventVisibilityStatus {
  return ev.visibility_status === "public" ? "public" : "private";
}

export function isPubliclyListableEventVisibility(
  visibility: string | null | undefined,
): boolean {
  return visibility === "public";
}

export function isPublicEventVisible(ev: EventStatusInput): boolean {
  return getEventVisibility(ev) === "public";
}

export function getEffectiveEventEnd(ev: EventStatusInput): number | null {
  return ev.end_time ?? null;
}

export function getEffectiveEventStart(ev: EventStatusInput): number | null {
  return ev.start_time ?? null;
}

export function computeEventStatus(
  ev: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): EventDisplayStatus {
  if (getEventVisibility(ev) !== "public") return "private";

  const effectiveEnd = getEffectiveEventEnd(ev);
  if (effectiveEnd != null && effectiveEnd <= now) return "ended";

  const effectiveStart = getEffectiveEventStart(ev);
  if (effectiveStart != null && effectiveStart > now) return "scheduled";

  if (effectiveStart != null || effectiveEnd != null) return "active";
  return "published";
}

export function eventStatusLabel(s: EventDisplayStatus): string {
  switch (s) {
    case "private": return "非公開";
    case "published": return "公開";
    case "scheduled": return "開始前";
    case "active": return "開催中";
    case "ended": return "終了済";
  }
}

export function eventStatusBadgeClass(s: EventDisplayStatus): string {
  switch (s) {
    case "active":
    case "published": return "fn-badge-accent";
    case "scheduled": return "fn-badge-warning";
    case "ended": return "fn-badge-neutral";
    case "private": return "fn-badge-soft";
  }
}

export function isAcceptingEntries(
  ev: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const status = computeEventStatus(ev, now);
  if (status === "private" || status === "ended") return false;
  if (ev.entry_start_time == null && ev.entry_end_time == null) return false;
  if (ev.entry_start_time != null && now < ev.entry_start_time) return false;
  if (ev.entry_end_time != null && now >= ev.entry_end_time) return false;
  return true;
}
