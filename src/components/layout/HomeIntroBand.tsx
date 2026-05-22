import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import type { events } from "@/lib/db/schema";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";
import { EventRecruitCard } from "./EventRecruitCard";

type EventRow = typeof events.$inferSelect;

export interface HomeIntroSlotStat {
  available: number;
  total: number;
}

interface HomeIntroBandProps {
  activeEvents: EventRow[];
  slotStats?: Map<string, HomeIntroSlotStat>;
}

const MAX_RECRUIT_CARDS = 3;

function isHeroCandidate(event: EventRow, now: number): boolean {
  const status = computeEventStatus(event, now);
  return status !== "draft" && status !== "ended" && status !== "archived";
}

function eventHeroRank(event: EventRow, now: number): number {
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

export function HomeIntroBand({
  activeEvents,
  slotStats,
}: HomeIntroBandProps): React.ReactElement | null {
  const now = Math.floor(Date.now() / 1000);
  const heroEvents = activeEvents
    .filter((event) => isHeroCandidate(event, now))
    .sort((a, b) => {
      const rankDiff = eventHeroRank(a, now) - eventHeroRank(b, now);
      if (rankDiff !== 0) return rankDiff;
      const aStart = a.start_time ?? Number.POSITIVE_INFINITY;
      const bStart = b.start_time ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });

  if (heroEvents.length === 0) return null;

  const [primary, ...rest] = heroEvents.slice(0, MAX_RECRUIT_CARDS);
  const hasMore = heroEvents.length > MAX_RECRUIT_CARDS;
  const primaryStat = slotStats?.get(primary.id);

  return (
    <section className={styles.heroWrap} aria-label="注目イベント">
      <EventRecruitCard
        event={primary}
        available={primaryStat ? primaryStat.available : null}
        total={primaryStat ? primaryStat.total : null}
        variant="primary"
      />

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
