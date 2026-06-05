import type { events } from "@/lib/db/schema";
import type { PublicEventCategory } from "@/components/event/PublicEventCard";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";

type EventRow = typeof events.$inferSelect;

/**
 * 公開イベント一覧の表示分類。DB状態は増やさず既存カラムから導出する。
 */
export function categorizePublicEvent(
  event: EventRow,
  now = Math.floor(Date.now() / 1000),
): PublicEventCategory {
  const status = computeEventStatus(event, now);
  if (status === "archived") return "archive";
  if (status === "ended") return "ended";
  if (isAcceptingEntries(event, now) || status === "active" || status === "published") {
    return "open";
  }
  return "upcoming";
}
