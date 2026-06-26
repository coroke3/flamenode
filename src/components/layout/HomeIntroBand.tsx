import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import type { events } from "@/lib/db/schema";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import { EventRecruitCard } from "./EventRecruitCard";

type EventRow = typeof events.$inferSelect;

export interface HomeIntroSlotStat {
  available: number;
  total: number;
}

const MAX_RECRUIT_CARDS = 3;

export function isHeroCandidate(event: EventRow, now: number): boolean {
  const status = computeEventStatus(event, now);
  return status !== "draft" && status !== "ended" && status !== "archived";
}

function eventHeroRank(event: EventRow, now: number): number {
  const status = computeEventStatus(event, now);
  if (status === "scheduled") {
    const start = event.start_time ?? event.end_time ?? Number.POSITIVE_INFINITY;
    return start - now;
  }
  const acceptingBonus = isAcceptingEntries(event) ? -10_000_000 : 0;
  const start =
    event.start_time ??
    event.end_time ??
    event.entry_start_time ??
    event.created_at ??
    now;
  if (start >= now) return acceptingBonus + (start - now);
  if (event.end_time != null && event.end_time >= now) {
    return acceptingBonus - 5_000_000;
  }
  return acceptingBonus + 100_000_000 + Math.abs(start - now);
}

export function pickHeroEvents(
  activeEvents: EventRow[],
  limit = MAX_RECRUIT_CARDS,
): EventRow[] {
  const now = Math.floor(Date.now() / 1000);
  return activeEvents
    .filter((event) => isHeroCandidate(event, now))
    .sort((a, b) => {
      const priorityDiff = compareEventsByUpcomingPriority(a, b, now);
      if (priorityDiff !== 0) return priorityDiff;
      const rankDiff = eventHeroRank(a, now) - eventHeroRank(b, now);
      if (rankDiff !== 0) return rankDiff;
      const aStart = a.start_time ?? Number.POSITIVE_INFINITY;
      const bStart = b.start_time ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    })
    .slice(0, limit);
}

interface HomeIntroBandProps {
  activeEvents: EventRow[];
  slotStats?: Map<string, HomeIntroSlotStat>;
  /** トップ intro で既に表示したイベント ID（重複表示を避ける） */
  excludeEventId?: string | null;
}

export function HomeIntroBand({
  activeEvents,
  slotStats,
  excludeEventId,
}: HomeIntroBandProps): React.ReactElement | null {
  const heroEvents = pickHeroEvents(activeEvents).filter(
    (event) => event.id !== excludeEventId,
  );

  if (heroEvents.length === 0) return null;

  const rest = heroEvents;
  const hasMore = activeEvents.filter((e) => isHeroCandidate(e, Math.floor(Date.now() / 1000))).length > MAX_RECRUIT_CARDS;

  return (
    <section className={`fn-public-container ${styles.heroWrap}`} aria-label="注目イベント">
      {rest.length > 0 ? (
        <div className={styles.recruitCompactRow}>
          {rest.map((event) => {
            const stat = slotStats?.get(event.id);
            return (
              <EventRecruitCard
                key={event.id}
                event={event}
                available={stat ? stat.available : null}
                total={stat ? stat.total : null}
                variant="compact"
              />
            );
          })}
        </div>
      ) : null}

      {hasMore ? (
        <div className={styles.recruitMore}>
          <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-sm">
            <Icon name="calendar" size={12} aria-hidden />
            すべてのイベントを見る ({heroEvents.length}件)
          </Link>
        </div>
      ) : null}
    </section>
  );
}
