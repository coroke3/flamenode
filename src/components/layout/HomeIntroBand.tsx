import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import type { events } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";

type EventRow = typeof events.$inferSelect;

interface HomeIntroBandProps {
  activeEvents: EventRow[];
}

/**
 * トップ最上部の短い導入帯。
 * 巨大ヒーローにせず、募集中イベントがあれば参加導線、なければ短いブランド帯を出す。
 * 高さはデスクトップ 180-250px、モバイル 150px 前後。
 */
export function HomeIntroBand({
  activeEvents,
}: HomeIntroBandProps): React.ReactElement {
  const featured =
    activeEvents.find((e) => isAcceptingEntries(e)) ?? activeEvents[0];

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

          {!featured ? (
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
          ) : null}
        </div>

        {featured ? (
          <div className={styles.eventBox}>
            <span className={styles.eventLabel}>
              <Icon name="alert" size={12} aria-hidden />
              {isAcceptingEntries(featured) ? "募集中イベント" : "開催中イベント"}
            </span>
            <Link
              href={`/event/${featured.id}`}
              className={styles.eventTitle}
            >
              {featured.title}
            </Link>
            {featured.explanation ? (
              <p className={styles.eventExplain}>{featured.explanation}</p>
            ) : null}
            <div className={styles.eventActions}>
              {isAcceptingEntries(featured) ? (
                <Link
                  href={`/entry?event=${featured.id}`}
                  className="fn-btn fn-btn-primary fn-btn-sm"
                >
                  <Icon name="calendar" size={12} aria-hidden />
                  スロットを確保する
                </Link>
              ) : null}
              <Link
                href={`/event/${featured.id}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                イベントを見る
                <Icon name="chevron-right" size={12} aria-hidden />
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
