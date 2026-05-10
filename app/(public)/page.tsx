import * as React from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  fetchActiveEvents,
  fetchLatestEvents,
  fetchLatestVideos,
  fetchPickupCreators,
  fetchRecommendedVideos,
  fetchVideosForEvent,
} from "@/lib/db/queries";
import { HomeIntroBand } from "@/components/layout/HomeIntroBand";
import { Shelf } from "@/components/layout/Shelf";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { EventPanel } from "@/components/layout/EventPanel";
import { Icon } from "@/components/ui/Icon";

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
  const db = getDatabase();

  let activeEvents: Awaited<ReturnType<typeof fetchActiveEvents>> = [];
  let recommended: VideoCardData[] = [];
  let latest: VideoCardData[] = [];
  let creators: Awaited<ReturnType<typeof fetchPickupCreators>> = [];
  let latestEvents: Awaited<ReturnType<typeof fetchLatestEvents>> = [];
  let videosByEvent: Record<string, VideoCardData[]> = {};

  if (db) {
    try {
      [activeEvents, recommended, latest, creators, latestEvents] =
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
      videosByEvent = Object.fromEntries(eventVideoEntries);
    } catch (e) {
      console.error("[TopPage] DB query failed", e);
    }
  }

  return (
    <div className={styles.page}>
      <HomeIntroBand activeEvents={activeEvents} />

      <section className={styles.section} aria-labelledby="sec-recommend">
        <SectionHeader title="おすすめ" moreHref="/recommend" />
        <div className={styles.shelfBox}>
          {recommended.length === 0 ? (
            <EmptyShelf message="まだおすすめできる作品がありません。" />
          ) : (
            <Shelf ariaLabel="おすすめ作品">
              {recommended.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-creators">
        <SectionHeader title="クリエイター" moreHref="/recommend#creators" />
        <div className={styles.shelfBox}>
          {creators.length === 0 ? (
            <EmptyShelf message="該当するクリエイターがまだいません。" />
          ) : (
            <Shelf ariaLabel="ピックアップクリエイター">
              {creators.map((c) => (
                <CreatorCard
                  key={c.id}
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

      <section className={styles.section} aria-labelledby="sec-latest">
        <SectionHeader title="最新の作品" moreHref="/list" />
        <div className={styles.shelfBox}>
          {latest.length === 0 ? (
            <EmptyShelf message="まだ公開作品がありません。" />
          ) : (
            <Shelf ariaLabel="最新作品">
              {latest.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </Shelf>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sec-events">
        <SectionHeader title="イベント" moreHref="/event" />
        <div className={styles.eventList}>
          {latestEvents.length === 0 ? (
            <p
              className="fn-empty-message"
              style={{ textAlign: "center", padding: "24px 0" }}
            >
              まだ公開中のイベントがありません。
            </p>
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
      <div className="fn-empty">
        <Icon name="info" size={24} aria-hidden />
        <p className="fn-empty-message">{message}</p>
      </div>
    </div>
  );
}
