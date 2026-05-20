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

  if (acceptingEvents.length > 0) {
    const [primary, ...rest] = acceptingEvents.slice(0, MAX_RECRUIT_CARDS);
    const hasMore = acceptingEvents.length > MAX_RECRUIT_CARDS;
    const primaryStat = slotStats?.get(primary.id);
    return (
      <section className={styles.heroWrap} aria-label="現在のイベント募集">
        {/* 主役カード: フル表示で 1 件だけ大きく見せる */}
        <EventRecruitCard
          event={primary}
          available={primaryStat ? primaryStat.available : null}
          total={primaryStat ? primaryStat.total : null}
          variant="primary"
        />
        {/* 副カード: compact variant でコンパクトに 2 件まで横並び (スマホは縦積み) */}
        {rest.length > 0 ? (
          <div className={styles.recruitCompactRow}>
            {rest.map((ev) => {
              const stat = slotStats?.get(ev.id);
              return (
                <EventRecruitCard
                  key={ev.id}
                  event={ev}
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
              <Icon name="calendar" size={12} aria-hidden /> 募集中イベントをすべて見る ({acceptingEvents.length}件)
            </Link>
          </div>
        ) : null}
        <QuickLinks />
      </section>
    );
  }

  // 募集中なし: 注目作品 (= activeEvents[0] fallback) または FlameNode ブランド帯
  const fallback = activeEvents[0];
  if (fallback) {
    const stat = slotStats?.get(fallback.id);
    return (
      <section className={styles.heroWrap} aria-label="現在のイベント募集">
        <EventRecruitCard
          event={fallback}
          available={stat ? stat.available : null}
          total={stat ? stat.total : null}
          variant="primary"
        />
        <QuickLinks />
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

/**
 * Hero 下のクイック導線。
 * 主要な遷移 (作品 / 募集中イベント / クリエイター / 新着) をフラットに並べる。
 * 黄色 CTA は使わず、薄い soft ボタンで「導線多めだけど主役を食わない」ようにする。
 */
function QuickLinks(): React.ReactElement {
  return (
    <nav className={styles.quickLinks} aria-label="トップのクイック導線">
      <Link
        href="/list"
        className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
      >
        <Icon name="grid" size={12} aria-hidden /> 作品を見る
      </Link>
      <Link
        href="/event"
        className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
      >
        <Icon name="calendar" size={12} aria-hidden /> 募集中イベント
      </Link>
      <Link
        href="/user"
        className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
      >
        <Icon name="users" size={12} aria-hidden /> クリエイター
      </Link>
      <Link
        href="/recommend"
        className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
      >
        <Icon name="heart" size={12} aria-hidden /> おすすめ
      </Link>
    </nav>
  );
}
