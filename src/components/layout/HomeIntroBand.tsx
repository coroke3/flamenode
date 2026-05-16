import * as React from "react";
import Link from "next/link";
import styles from "./HomeIntroBand.module.css";
import { Icon } from "@/components/ui/Icon";
import type { events } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";

type EventRow = typeof events.$inferSelect;

interface HomeIntroBandProps {
  activeEvents: EventRow[];
  /** event_id -> available スロット件数 */
  slotCounts?: Map<string, number>;
}

/**
 * トップ最上部の短い導入帯。
 * 巨大ヒーローにせず、募集中イベントがあれば参加導線、なければ短いブランド帯を出す。
 * 高さはデスクトップ 180-250px、モバイル 150px 前後。
 */
export function HomeIntroBand({
  activeEvents,
  slotCounts,
}: HomeIntroBandProps): React.ReactElement {
  const featured =
    activeEvents.find((e) => isAcceptingEntries(e)) ?? activeEvents[0];
  const availableSlots = featured ? (slotCounts?.get(featured.id) ?? null) : null;

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
            <dl className={styles.eventMeta}>
              {featured.start_time ? (
                <div className={styles.eventMetaItem}>
                  <dt>
                    <Icon name="calendar" size={11} aria-hidden />
                    開催日時
                  </dt>
                  <dd>
                    {formatUnix(featured.start_time)}
                    {featured.end_time
                      ? ` 〜 ${formatUnix(featured.end_time)}`
                      : ""}
                  </dd>
                </div>
              ) : null}
              {isAcceptingEntries(featured) ? (
                <div className={styles.eventMetaItem}>
                  <dt>
                    <Icon name="clock" size={11} aria-hidden />
                    募集
                  </dt>
                  <dd>
                    {featured.entry_start_time != null || featured.entry_end_time != null ? (
                      <>
                        募集期間:{" "}
                        {featured.entry_start_time != null
                          ? formatUnix(featured.entry_start_time)
                          : ""}
                        {" 〜 "}
                        {featured.entry_end_time != null
                          ? formatUnix(featured.entry_end_time)
                          : ""}
                      </>
                    ) : (
                      "受付中"
                    )}
                  </dd>
                </div>
              ) : null}
              {availableSlots !== null ? (
                <div className={styles.eventMetaItem}>
                  <dt>
                    <Icon name="list" size={11} aria-hidden />
                    残り枠
                  </dt>
                  <dd>{availableSlots} 枠</dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.howToJoin}>
              参加するには Discord でログインし、スロットを確保してください。
              <Link href="/entry" className={styles.howToJoinLink}>
                参加方法を見る
              </Link>
            </p>
            <div className={styles.eventActions}>
              {isAcceptingEntries(featured) ? (
                <Link
                  href={`/event/${featured.id}#slot`}
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
