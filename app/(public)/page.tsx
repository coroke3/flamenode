import * as React from "react";
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
  publicVideoCondition,
} from "@/lib/db/queries";
import { fetchPublicAnnouncements } from "@/lib/db/announcementQueries";
import {
  slots as slotsTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import {
  HomeIntroBand,
  type HomeIntroSlotStat,
} from "@/components/layout/HomeIntroBand";
import { HomeEditorialHero } from "@/components/layout/HomeEditorialHero";
import { HomeClosingCta } from "@/components/layout/HomeClosingCta";
import { Shelf } from "@/components/layout/Shelf";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { VideoCard } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { EventPanel } from "@/components/layout/EventPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  type HomeFeatureVideo,
  type HomeStats,
  uniqueHomeVideos,
} from "@/components/layout/homeVisuals";

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
    const [
      activeEvents,
      recommendedRaw,
      latest,
      creators,
      latestEvents,
      announcements,
    ] = await Promise.all([
      fetchActiveEvents(db),
      fetchRecommendedVideos(db, 40).then((rows) => shuffle(rows).slice(0, 30)),
      fetchLatestVideos(db, 30),
      fetchPickupCreators(db, 30),
      fetchLatestEvents(db, 3),
      fetchPublicAnnouncements(db, "all", 3),
    ]);

    const [videoCountRows, creatorCountRows] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(videosTable)
        .where(publicVideoCondition),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(xUsersTable)
        .where(sql`${xUsersTable.approval_status} IN ('approved', 'pending')`),
    ]);

    const videosByEvent = Object.fromEntries(
      await Promise.all(
        latestEvents.map(async (event) => {
          const videos = await fetchVideosForEvent(db, event.id, 8);
          return [event.id, videos] as const;
        }),
      ),
    );

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
      announcements,
      videosByEvent,
      topSlotStats,
      stats: {
        publicVideos: Number(videoCountRows[0]?.count ?? latest.length),
        activeEvents: activeEvents.length,
        creators: Number(creatorCountRows[0]?.count ?? creators.length),
      } satisfies HomeStats,
    };
  });

  const {
    activeEvents = [],
    recommended = [],
    latest = [],
    creators = [],
    latestEvents = [],
    announcements = [],
    videosByEvent = {},
    topSlotStats = new Map<string, HomeIntroSlotStat>(),
    stats = {
      publicVideos: latest.length,
      activeEvents: activeEvents.length,
      creators: creators.length,
    },
  } = data ?? {};

  const heroVideos = uniqueHomeVideos([
    ...(recommended as HomeFeatureVideo[]),
    ...(latest as HomeFeatureVideo[]),
  ]).slice(0, 5);

  return (
    <div className={styles.page}>
      <HomeEditorialHero stats={stats} videos={heroVideos} />
      {announcements.length > 0 ? (
        <section
          className={styles.section}
          aria-label="お知らせ"
          style={{ paddingTop: 18, paddingBottom: 0 }}
        >
          <div className={styles.announcementList}>
            {announcements.map((item) => (
              <article key={item.id} className={styles.announcement}>
                <strong>{item.title}</strong>
                <p className="fn-muted fn-text-sm">
                  {item.body.length > 180
                    ? `${item.body.slice(0, 179)}...`
                    : item.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <HomeIntroBand activeEvents={activeEvents} slotStats={topSlotStats} />

      <section className={styles.section} aria-labelledby="sec-recommend">
        <SectionHeader
          title="今週のピックアップ"
          description="Selected by editors"
          moreHref="/recommend"
          moreLabel="一覧を見る"
        />
        <div className={styles.shelfBox}>
          {recommended.length === 0 ? (
            <EmptyShelf message="おすすめできる作品を準備しています。" />
          ) : (
            <Shelf ariaLabel="今週のピックアップ">
              {recommended.map((video, index) => (
                <VideoCard key={`${video.id}-recommended-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-creators">
        <SectionHeader
          title="注目クリエイター"
          description="Featured artists"
          moreHref="/user"
          moreLabel="もっと見る"
        />
        <div className={styles.shelfBox}>
          {creators.length === 0 ? (
            <EmptyShelf message="紹介できるクリエイターを準備しています。" />
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
        <SectionHeader
          title="新着アップロード"
          description="Just dropped"
          moreHref="/list"
          moreLabel="すべて見る"
        />
        <div className={styles.shelfBox}>
          {latest.length === 0 ? (
            <EmptyShelf message="公開作品を準備しています。" />
          ) : (
            <Shelf ariaLabel="新着アップロード">
              {latest.map((video, index) => (
                <VideoCard key={`${video.id}-latest-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-events">
        <SectionHeader
          title="募集中のイベント"
          description="Open for entry"
          moreHref="/event"
          moreLabel="すべて見る"
        />
        <div className={styles.eventList}>
          {latestEvents.length === 0 ? (
            <EmptyShelf message="公開中のイベントを準備しています。" />
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
      </section>

      <HomeClosingCta />
    </div>
  );
}

function EmptyShelf({ message }: { message: string }): React.ReactElement {
  return (
    <div className={styles.empty}>
      <EmptyState title="準備中" description={message} />
    </div>
  );
}
