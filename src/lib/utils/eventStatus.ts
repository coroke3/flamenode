import { and, eq, gt, isNull, or } from "drizzle-orm";
import { events } from "@/lib/db/schema";

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

export function computeEventStatus(
  ev: EventStatusInput,
  now: number = Math.floor(Date.now() / 1000),
): EventDisplayStatus {
  if (ev.is_archived === 1) return "archived";
  if (ev.is_active !== 1) return "draft";
  if (ev.end_time != null && ev.end_time <= now) return "ended";
  if (ev.start_time != null && ev.start_time > now) return "scheduled";
  if (ev.start_time != null && ev.end_time != null) return "active";
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
  // 募集期間が設定されている場合は時刻範囲も確認する。
  // entry_start_time のみ: 開始前は false。
  // entry_end_time のみ: 終了後は false。
  // 両方 null: 従来どおり is_entry_open のみで判定。
  if (ev.entry_start_time != null && now < ev.entry_start_time) return false;
  if (ev.entry_end_time != null && now > ev.entry_end_time) return false;
  return true;
}

export function activeEventWhere(now: number = Math.floor(Date.now() / 1000)) {
  return and(
    eq(events.is_active, 1),
    eq(events.is_archived, 0),
    or(isNull(events.end_time), gt(events.end_time, now))!,
  );
}
