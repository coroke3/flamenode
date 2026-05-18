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
export function HomeIntroBand({
  activeEvents,
  slotStats,
}: HomeIntroBandProps): React.ReactElement {
  const featured =
    activeEvents.find((e) => isAcceptingEntries(e)) ?? activeEvents[0];

  if (featured) {
    const stat = slotStats?.get(featured.id);
    return (
      <section className={styles.heroWrap} aria-label="現在のイベント募集">
        <EventRecruitCard
          event={featured}
          available={stat ? stat.available : null}
          total={stat ? stat.total : null}
        />
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
