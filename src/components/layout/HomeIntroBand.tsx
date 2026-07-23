import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import { isHeroCandidate, pickHeroEvents } from "@/lib/utils/pickHeroEvents";
import { EventRecruitCard, type RecruitEvent } from "./EventRecruitCard";

export { isHeroCandidate, pickHeroEvents } from "@/lib/utils/pickHeroEvents";

export interface HomeIntroSlotStat {
  available: number;
  total: number;
}

const MAX_RECRUIT_CARDS = 3;

type EventRow = RecruitEvent;

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
  const heroEvents = pickHeroEvents(activeEvents, MAX_RECRUIT_CARDS).filter(
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
