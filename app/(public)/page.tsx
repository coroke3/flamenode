import * as React from "react";
import type { Metadata } from "next";
import styles from "./page.module.css";
import {
  HomeIntroBand,
  pickHeroEvents,
  type HomeIntroSlotStat,
} from "@/components/layout/HomeIntroBand";
import { HomeTopIntro } from "@/components/layout/HomeTopIntro";
import { HomeClosingCta } from "@/components/layout/HomeClosingCta";
import { PublicEventCard } from "@/components/event/PublicEventCard";
import { categorizePublicEvent } from "@/lib/utils/categorizePublicEvent";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Shelf } from "@/components/layout/Shelf";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { VideoCard } from "@/components/video/VideoCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { type HomeStats } from "@/components/layout/homeVisuals";
import {
  isDegradedD1Mode,
  loadStaticTopPage,
  logPublicRequestMetrics,
  setPublicRequestRoute,
} from "@/lib/publicData/loader";
import type { StaticTopData } from "@/lib/publicData/loader";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  absoluteUrl,
  buildPageMetadata,
} from "@/lib/seo";
import { shuffledCopy } from "@/lib/utils/shuffle";

/** 新着 loop 棚に載せる最大枚数。シャッフル元プールは100件のまま。 */
const TOP_LATEST_LOOP_DISPLAY_LIMIT = 40;

export const metadata: Metadata = buildPageMetadata({
  path: "/",
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
});

export const dynamic = "force-dynamic";

export default async function TopPage(): Promise<React.ReactElement> {
  setPublicRequestRoute("/");
  const staticLoaded = await loadStaticTopPage();
  const isDegraded = isDegradedD1Mode(staticLoaded.mode);
  const data: StaticTopData | null = staticLoaded.top;

  const {
    activeEvents = [],
    recommended = [],
    latest = [],
    nostalgic = [],
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
  // top.json 自体の内容・順序は変えず、このrequestの表示順だけを入れ替える。
  const randomizedRecommended = shuffledCopy(recommended);
  const randomizedLatest = shuffledCopy(latest.slice(0, 100));
  const latestLoopItems = randomizedLatest.slice(0, TOP_LATEST_LOOP_DISPLAY_LIMIT);
  const randomizedNostalgic = shuffledCopy(nostalgic);

  const heroEvents = pickHeroEvents(activeEvents);
  const primaryHeroEvent = heroEvents[0] ?? null;
  const primaryHeroStat = primaryHeroEvent
    ? topSlotStats.get(primaryHeroEvent.id)
    : undefined;

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: SITE_DESCRIPTION,
    inLanguage: "ja",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/list?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };

  logPublicRequestMetrics();
  return (
    <div className={`fn-main ${styles.page}`}>
      <JsonLd data={websiteJsonLd} />
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

      {!isDegraded ? (
      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-recommend">
        <SectionHeader
          eyebrow="PICKS"
          title="今週のピックアップ"
          moreHref="/recommend"
          moreLabel="一覧を見る"
        />
        <div className={styles.shelfBox}>
          {randomizedRecommended.length === 0 ? (
            <EmptyShelf message="おすすめできる作品がまだありません。" />
          ) : (
            <Shelf
              ariaLabel="今週のピックアップ"
              loop
              autoScrollDirection="left"
            >
              {randomizedRecommended.map((video, index) => (
                <VideoCard key={`${video.id}-recommended-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>
      ) : null}

      <section className={`fn-public-container fn-section ${styles.section}`} aria-labelledby="sec-latest">
        <SectionHeader
          eyebrow="LATEST"
          title="新着アップロード"
          moreHref="/list"
          moreLabel="すべて見る"
        />
        <div className={styles.shelfBox}>
          {latestLoopItems.length === 0 ? (
            <EmptyShelf message="公開作品がまだありません。" />
          ) : (
            <Shelf
              ariaLabel="新着アップロード"
              loop
              autoScrollDirection="right"
            >
              {latestLoopItems.map((video, index) => (
                <VideoCard key={`${video.id}-latest-${index}`} video={video} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      {!isDegraded ? (
        <section
          className={`fn-public-container fn-section ${styles.section}`}
          aria-label="懐かしの映像"
        >
          <SectionHeader
            eyebrow="ARCHIVE"
            title="懐かしの映像"
            description="公開から3年以上たった作品を、アーカイブから再発見。"
            moreHref="/list?sort=old"
            moreLabel="過去の作品を見る"
          />
          <div className={styles.shelfBox}>
            {randomizedNostalgic.length === 0 ? (
              <EmptyShelf message="対象になる作品がまだありません。" />
            ) : (
              <Shelf
                ariaLabel="懐かしの映像"
                loop
                autoScrollDirection="left"
              >
                {randomizedNostalgic.map((video, index) => (
                  <VideoCard key={`${video.id}-nostalgic-${index}`} video={video} />
                ))}
              </Shelf>
            )}
          </div>
        </section>
      ) : null}

      {!isDegraded ? (
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
      ) : null}

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
