import type { PublicEventCategory } from "@/components/event/PublicEventCard";
import {
  computeEventStatus,
  isAcceptingEntries,
  type EventStatusInput,
} from "@/lib/utils/eventStatus";

/**
 * 公開イベント一覧の表示分類。DB状態は増やさず既存カラムから導出する。
 */
export function categorizePublicEvent(
  event: EventStatusInput,
  now = Math.floor(Date.now() / 1000),
): PublicEventCategory {
  const status = computeEventStatus(event, now);
  if (status === "ended") return "ended";
  if (isAcceptingEntries(event, now) || status === "active" || status === "published") {
    return "open";
  }
  return "upcoming";
}
