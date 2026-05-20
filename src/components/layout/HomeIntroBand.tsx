import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import type { events } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { EventRecruitCard } from "./EventRecruitCard";

type EventRow = typeof events.$inferSelect;

export interface HomeIntroSlotStat {
  available: number;
  total: number;
}

interface HomeIntroBandProps {
  activeEvents: EventRow[];
  /** event_id -> { available, total } の集計。available 単独で欲しい従来用途は available のみ参照される。 */
  slotStats?: Map<string, HomeIntroSlotStat>;
}

/**
 * トップ最上部の導入ブロック。
 * - 募集中 / 開催中などの featured イベントがある → 募集カード (EventRecruitCard) を主役として全幅表示
 * - 何もない → FlameNode のブランド帯 (作品一覧 / おすすめ 導線)
 *
 * 仕様: 募集カードは黒ベース + 黄色アクセントの「主役級UI」。
 */
const MAX_RECRUIT_CARDS = 3;

export function HomeIntroBand({
  activeEvents,
  slotStats,
}: HomeIntroBandProps): React.ReactElement {
  // 募集中イベントを募集締切が近い順で複数表示する。
  // 締切未設定は最後尾。同点なら開催日 (effective start) で並べる。
  const acceptingEvents = activeEvents
    .filter((e) => isAcceptingEntries(e))
    .sort((a, b) => {
      const aEnd = a.entry_end_time ?? Number.POSITIVE_INFINITY;
      const bEnd = b.entry_end_time ?? Number.POSITIVE_INFINITY;
      if (aEnd !== bEnd) return aEnd - bEnd;
      const aStart = a.start_time ?? Number.POSITIVE_INFINITY;
      const bStart = b.start_time ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });

  if (acceptingEvents.length === 0) {
    // 募集中が無い場合は最も近い 1 件を fallback として表示 (旧挙動互換)。
    const fallback = activeEvents[0];
    if (fallback) {
      const stat = slotStats?.get(fallback.id);
      return (
        <section className={styles.heroWrap} aria-label="現在のイベント募集">
          <EventRecruitCard
            event={fallback}
            available={stat ? stat.available : null}
            total={stat ? stat.total : null}
          />
        </section>
      );
    }
  }

  if (acceptingEvents.length > 0) {
    const shown = acceptingEvents.slice(0, MAX_RECRUIT_CARDS);
    const hasMore = acceptingEvents.length > MAX_RECRUIT_CARDS;
    return (
      <section className={styles.heroWrap} aria-label="現在のイベント募集">
        <div className={styles.recruitStack}>
          {shown.map((ev) => {
            const stat = slotStats?.get(ev.id);
            return (
              <EventRecruitCard
                key={ev.id}
                event={ev}
                available={stat ? stat.available : null}
                total={stat ? stat.total : null}
              />
            );
          })}
        </div>
        {hasMore ? (
          <div className={styles.recruitMore}>
            <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-sm">
              <Icon name="calendar" size={12} aria-hidden /> 募集中イベントをすべて見る ({acceptingEvents.length}件)
            </Link>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={styles.band} aria-label="FlameNode について">
      <div className={styles.inner}>
        <div className={styles.brand}>
          <h1 className={styles.title}>FlameNode</h1>
          <p className={styles.lead}>
            映像（フレーム）の結節点（ノード）。
            <span className={styles.leadDesktop}>
              {" "}
              作品 · 作者 · イベント · 視聴者の接点を継続的につなぐ動画プラットフォーム。
            </span>
          </p>
          <div className={styles.actions}>
            <Link href="/list" className="fn-btn fn-btn-primary">
              <Icon name="list" size={14} aria-hidden />
              作品一覧から探す
            </Link>
            <Link href="/recommend" className="fn-btn fn-btn-ghost">
              <Icon name="heart" size={14} aria-hidden />
              おすすめ
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
