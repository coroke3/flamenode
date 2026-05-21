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
import { VideoCard } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { EventPanel } from "@/components/layout/EventPanel";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

function shuffle<T>(items: T[]): T[] {
  const copied = [...items];
  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

export default async function TopPage(): Promise<React.ReactElement> {
  const data = await withDatabase(async (db) => {
    const [activeEvents, recommendedRaw, latest, creators, latestEvents] =
      await Promise.all([
        fetchActiveEvents(db),
        fetchRecommendedVideos(db, 40).then((rows) =>
          shuffle(rows).slice(0, 30),
        ),
        fetchLatestVideos(db, 30),
        fetchPickupCreators(db, 30),
        fetchLatestEvents(db, 3),
      ]);

    const eventVideoEntries = await Promise.all(
      latestEvents.map(async (event) => {
        const videos = await fetchVideosForEvent(db, event.id, 8);
        return [event.id, videos] as const;
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

      <section className={styles.quickSection} aria-label="作品を見る導線">
        <div className={styles.watchBand}>
          <div>
            <p className={styles.watchEyebrow}>Watch FlameNode</p>
            <h2 className={styles.watchTitle}>まずは作品を見る</h2>
            <p className={styles.watchText}>
              イベントの熱量はそのままに、作品棚から気になる映像へすぐ入れます。
            </p>
          </div>
          <div className={styles.watchActions}>
            <Link href="/list" className="fn-btn fn-btn-primary">
              <Icon name="play" size={14} aria-hidden />
              作品を見る
            </Link>
            <Link href="/event" className="fn-btn fn-btn-ghost">
              <Icon name="calendar" size={14} aria-hidden />
              エントリーする
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-recommend">
        <SectionHeader title="人気作品" moreHref="/recommend" />
        <div className={styles.shelfBox}>
          {recommended.length === 0 ? (
            <EmptyShelf message="まだおすすめできる作品がありません。" />
          ) : (
            <Shelf ariaLabel="人気作品">
              {recommended.map((video, index) => (
                <VideoCard
                  key={`${video.id}-recommended-${index}`}
                  video={video}
                />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-creators">
        <SectionHeader title="注目クリエイター" moreHref="/user" />
        <div className={styles.shelfBox}>
          {creators.length === 0 ? (
            <EmptyShelf message="該当するクリエイターがまだいません。" />
          ) : (
            <Shelf ariaLabel="注目クリエイター">
              {creators.map((creator, index) => (
                <CreatorCard
                  key={`${creator.id}-creator-${index}`}
                  data={{
                    id: creator.id,
                    x_name: creator.x_name,
                    icon_url: creator.icon_url,
                    video_count:
                      (Number(creator.video_count) || 0) +
                      (Number(creator.collab_count) || 0),
                  }}
                />
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
              {latest.map((video, index) => (
                <VideoCard key={`${video.id}-latest-${index}`} video={video} />
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
            latestEvents.map((event) => (
              <EventPanel
                key={event.id}
                event={event}
                videos={videosByEvent[event.id] ?? []}
              />
            ))
          )}
        </div>
        <div className={styles.center}>
          <Link href="/event" className="fn-btn fn-btn-ghost">
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
