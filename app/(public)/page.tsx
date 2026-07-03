import * as React from "react";
import styles from "./page.module.css";
import { sql } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import {
  countablePublicVideoCondition,
  countVideosForEvent,
  fetchActiveEvents,
  fetchLatestEvents,
  fetchLatestVideos,
  fetchPickupCreators,
  fetchRecommendedVideos,
} from "@/lib/db/queries";
import { fetchPublicAnnouncements } from "@/lib/db/announcementQueries";
import {
  slots as slotsTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import {
  HomeIntroBand,
  pickHeroEvents,
  type HomeIntroSlotStat,
} from "@/components/layout/HomeIntroBand";
import { HomeTopIntro } from "@/components/layout/HomeTopIntro";
import { HomeClosingCta } from "@/components/layout/HomeClosingCta";
import { PublicEventCard } from "@/components/event/PublicEventCard";
import { categorizePublicEvent } from "@/lib/utils/categorizePublicEvent";
import { computeEventStatus, isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Shelf } from "@/components/layout/Shelf";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { VideoCard } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { type HomeStats } from "@/components/layout/homeVisuals";
import type { events } from "@/lib/db/schema";
import type { PublicEventCategory } from "@/components/event/PublicEventCard";

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
      fetchLatestEvents(db, 4),
      fetchPublicAnnouncements(db, "all", 3),
    ]);

    const [videoCountRows, creatorCountRows] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(videosTable)
        .where(countablePublicVideoCondition),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(xUsersTable)
        .where(sql`${xUsersTable.approval_status} IN ('approved', 'pending')`),
    ]);

    const eventVideoCounts = Object.fromEntries(
      await Promise.all(
        latestEvents.map(async (event) => {
          const count = await countVideosForEvent(db, event.id);
          return [event.id, count] as const;
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
      eventVideoCounts,
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
    eventVideoCounts = {},
    topSlotStats = new Map<string, HomeIntroSlotStat>(),
    stats = {
      publicVideos: latest.length,
      activeEvents: activeEvents.length,
      creators: creators.length,
    },
  } = data ?? {};

  const heroEvents = pickHeroEvents(activeEvents);
  const primaryHeroEvent = heroEvents[0] ?? null;
  const primaryHeroStat = primaryHeroEvent
    ? topSlotStats.get(primaryHeroEvent.id)
    : undefined;

  return (
    <div className={`fn-main ${styles.page}`}>
      <HomeTopIntro
        stats={stats}
        primaryEvent={primaryHeroEvent}
        primarySlotStat={primaryHeroStat}
      />
      {announcements.length > 0 ? (
        <section
          className={`fn-public-container fn-announcement-band ${styles.section}`}
          aria-label="お知らせ"
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
      <HomeIntroBand
        activeEvents={activeEvents}
        slotStats={topSlotStats}
        excludeEventId={primaryHeroEvent?.id}
      />

      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-recommend">
        <SectionHeader
          eyebrow="PICKS"
          title="今週のピックアップ"
          moreHref="/recommend"
          moreLabel="一覧を見る"
        />
        <div className={styles.shelfBox}>
          {recommended.length === 0 ? (
            <EmptyShelf message="おすすめできる作品がまだありません。" />
          ) : (
            <Shelf ariaLabel="今週のピックアップ">
              {recommended.map((video, index) => (
                <VideoCard key={`${video.id}-recommended-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-creators">
        <SectionHeader
          eyebrow="CREATORS"
          title="注目クリエイター"
          moreHref="/user"
          moreLabel="もっと見る"
        />
        <div className={styles.shelfBox}>
          {creators.length === 0 ? (
            <EmptyShelf message="紹介できるクリエイターがまだありません。" />
          ) : (
            <Shelf ariaLabel="注目クリエイター" density="compact">
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

      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-latest">
        <SectionHeader
          eyebrow="LATEST"
          title="新着アップロード"
          moreHref="/list"
          moreLabel="すべて見る"
        />
        <div className={styles.shelfBox}>
          {latest.length === 0 ? (
            <EmptyShelf message="公開作品がまだありません。" />
          ) : (
            <Shelf ariaLabel="新着アップロード">
              {latest.map((video, index) => (
                <VideoCard key={`${video.id}-latest-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-events">
        <SectionHeader
          eyebrow="EVENTS"
          title="最近のイベント"
          moreHref="/event"
          moreLabel="イベント一覧"
        />
        <div className="fn-evlist-grid">
          {latestEvents.length === 0 ? (
            <EmptyShelf message="公開中のイベントがまだありません。" />
          ) : (
            latestEvents.map((event) => (
              <PublicEventCard
                key={event.id}
                event={event}
                category={categorizePublicEvent(event)}
                videoCount={eventVideoCounts[event.id] ?? 0}
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
      <EmptyState title="まだありません" description={message} />
    </div>
  );
}
