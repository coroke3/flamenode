import * as React from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { sql } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import {
  fetchActiveEvents,
  fetchLatestEvents,
  fetchLatestVideos,
  fetchPickupCreators,
  fetchRecommendedVideos,
  fetchVideosForEvent,
} from "@/lib/db/queries";
import { slots as slotsTable } from "@/lib/db/schema";
import {
  HomeIntroBand,
  type HomeIntroSlotStat,
} from "@/components/layout/HomeIntroBand";
import { Shelf } from "@/components/layout/Shelf";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { EventPanel } from "@/components/layout/EventPanel";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/** Fisher-Yates シャッフル。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function TopPage(): Promise<React.ReactElement> {
  const data = await withDatabase(async (db) => {
    const [activeEvents, recommendedRaw, latest, creators, latestEvents] =
      await Promise.all([
        fetchActiveEvents(db),
        fetchRecommendedVideos(db, 40).then((rs) => shuffle(rs).slice(0, 30)),
        fetchLatestVideos(db, 30),
        fetchPickupCreators(db, 30),
        fetchLatestEvents(db, 3),
      ]);

    const eventVideoEntries = await Promise.all(
      latestEvents.map(async (ev) => {
        const vs = await fetchVideosForEvent(db, ev.id, 8);
        return [ev.id, vs] as const;
      }),
    );
    const videosByEvent = Object.fromEntries(eventVideoEntries);

    const topSlotStats = new Map<string, HomeIntroSlotStat>();
    if (activeEvents.length > 0) {
      const slotRows = await db
        .select({
          event_id: slotsTable.event_id,
          available: sql<number>`SUM(CASE WHEN ${slotsTable.status} = 'available' THEN 1 ELSE 0 END)`,
          total: sql<number>`COUNT(*)`,
        })
        .from(slotsTable)
        .groupBy(slotsTable.event_id);
      slotRows.forEach((row) =>
        topSlotStats.set(row.event_id, {
          available: Number(row.available ?? 0),
          total: Number(row.total ?? 0),
        }),
      );
    }

    return {
      activeEvents,
      recommended: recommendedRaw,
      latest,
      creators,
      latestEvents,
      videosByEvent,
      topSlotStats,
    };
  });

  const {
    activeEvents = [],
    recommended = [],
    latest = [],
    creators = [],
    latestEvents = [],
    videosByEvent = {},
    topSlotStats = new Map<string, HomeIntroSlotStat>(),
  } = data ?? {};

  return (
    <div className={styles.page}>
      <HomeIntroBand activeEvents={activeEvents} slotStats={topSlotStats} />

      <section className={styles.section} aria-labelledby="sec-recommend">
        <SectionHeader title="今日見るべき作品" moreHref="/recommend" />
        <div className={styles.shelfBox}>
          {recommended.length === 0 ? (
            <EmptyShelf message="まだおすすめできる作品がありません。" />
          ) : (
            <Shelf ariaLabel="今日見るべき作品">
              {recommended.map((v, index) => (
                <VideoCard key={`${v.id}-recommended-${index}`} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-latest">
        <SectionHeader title="新着作品" moreHref="/list" />
        <div className={styles.shelfBox}>
          {latest.length === 0 ? (
            <EmptyShelf message="まだ公開作品がありません。" />
          ) : (
            <Shelf ariaLabel="新着作品">
              {latest.map((v, index) => (
                <VideoCard key={`${v.id}-latest-${index}`} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-creators">
        <SectionHeader title="クリエイター" moreHref="/user" />
        <div className={styles.shelfBox}>
          {creators.length === 0 ? (
            <EmptyShelf message="該当するクリエイターがまだいません。" />
          ) : (
            <Shelf ariaLabel="ピックアップクリエイター">
              {creators.map((c, index) => (
                <CreatorCard
                  key={`${c.id}-creator-${index}`}
                  data={{
                    id: c.id,
                    x_name: c.x_name,
                    icon_url: c.icon_url,
                    video_count:
                      (Number(c.video_count) || 0) +
                      (Number(c.collab_count) || 0),
                  }}
                />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-events">
        <SectionHeader title="イベント" moreHref="/event" />
        <div className={styles.eventList}>
          {latestEvents.length === 0 ? (
            <EmptyShelf message="まだ公開中のイベントがありません。" />
          ) : (
            latestEvents.map((ev) => (
              <EventPanel
                key={ev.id}
                event={ev}
                videos={videosByEvent[ev.id] ?? []}
              />
            ))
          )}
        </div>
        <div className={styles.center}>
          <Link href="/event" className="fn-btn fn-btn-ghost">
            <Icon name="calendar" size={14} aria-hidden />
            すべてのイベントを見る
          </Link>
        </div>
      </section>
    </div>
  );
}

function EmptyShelf({ message }: { message: string }): React.ReactElement {
  return (
    <div className={styles.empty}>
      <EmptyState title="まだ準備中です" description={message} />
    </div>
  );
}
