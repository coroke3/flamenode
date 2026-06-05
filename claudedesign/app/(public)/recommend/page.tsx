import * as React from "react";
import type { Metadata } from "next";
import { withDatabase } from "@/lib/cloudflare";
import {
  fetchLatestVideos,
  fetchPickupCreators,
  fetchRecommendedVideos,
  fetchUnderratedVideos,
} from "@/lib/db/queries";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { CreatorCard } from "@/components/user/CreatorCard";
import { Shelf } from "@/components/layout/Shelf";
import { Icon } from "@/components/ui/Icon";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "おすすめ" };
export const dynamic = "force-dynamic";

const LIST_HREF = "/list";

function pickDiverseVideos<
  T extends {
    id: string;
    creator_x_user_id?: string | null;
    primary_event_id?: string | null;
  },
>(
  rows: readonly T[],
  options: { target: number; maxPerCreator?: number; maxPerEvent?: number },
): T[] {
  const target = Math.max(0, options.target);
  const maxPerCreator = options.maxPerCreator ?? 3;
  const maxPerEvent = options.maxPerEvent ?? 5;
  const creatorCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const out: T[] = [];
  const skipped: T[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const creatorId = row.creator_x_user_id;
    const eventId = row.primary_event_id;
    if (creatorId && (creatorCounts.get(creatorId) ?? 0) >= maxPerCreator) {
      skipped.push(row);
      continue;
    }
    if (eventId && (eventCounts.get(eventId) ?? 0) >= maxPerEvent) {
      skipped.push(row);
      continue;
    }
    seen.add(row.id);
    if (creatorId) {
      creatorCounts.set(creatorId, (creatorCounts.get(creatorId) ?? 0) + 1);
    }
    if (eventId) {
      eventCounts.set(eventId, (eventCounts.get(eventId) ?? 0) + 1);
    }
    out.push(row);
    if (out.length >= target) return out;
  }

  for (const row of skipped) {
    if (out.length >= target) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }

  return out;
}

function uniqueVideos<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function withoutVideo<T extends { id: string }>(
  rows: readonly T[],
  id?: string,
): T[] {
  return id ? rows.filter((row) => row.id !== id) : [...rows];
}

interface FilterChip {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const FILTER_CHIPS: FilterChip[] = [
  {
    href: "#rail-hot",
    label: "伸びている",
    icon: <Icon name="alert" size={11} aria-hidden />,
  },
  {
    href: "#rail-fresh",
    label: "新着",
    icon: <Icon name="clock" size={11} aria-hidden />,
  },
  {
    href: "#rail-underrated",
    label: "見落としがち",
    icon: <Icon name="info" size={11} aria-hidden />,
  },
  {
    href: "#rail-events",
    label: "イベント",
    icon: <Icon name="calendar" size={11} aria-hidden />,
  },
  {
    href: "#rail-more",
    label: "まとめて見る",
    icon: <Icon name="grid" size={11} aria-hidden />,
  },
  {
    href: "#rail-creators",
    label: "クリエイター",
    icon: <Icon name="users" size={11} aria-hidden />,
  },
];

export default async function RecommendPage(): Promise<React.ReactElement> {
  const data = await withDatabase(async (db) => {
    const [recommended, latest, underrated, creators] = await Promise.all([
      fetchRecommendedVideos(db, 120),
      fetchLatestVideos(db, 80),
      fetchUnderratedVideos(db, 80),
      fetchPickupCreators(db, 40),
    ]);
    return { recommended, latest, underrated, creators };
  });

  const {
    recommended = [],
    latest = [],
    underrated: underratedPool = [],
    creators = [],
  } = data ?? {};

  const allCandidates = uniqueVideos([
    ...(recommended as VideoCardData[]),
    ...(latest as VideoCardData[]),
    ...(underratedPool as VideoCardData[]),
  ]);

  const hero = recommended[0] ?? latest[0] ?? underratedPool[0];
  const nonHeroRecommended = withoutVideo(recommended, hero?.id);
  const nonHeroLatest = withoutVideo(latest, hero?.id);
  const nonHeroUnderrated = withoutVideo(underratedPool, hero?.id);

  const hot = pickDiverseVideos(nonHeroRecommended, {
    target: 12,
    maxPerCreator: 3,
    maxPerEvent: 5,
  }) as VideoCardData[];

  const fresh = pickDiverseVideos(nonHeroLatest, {
    target: 12,
    maxPerCreator: 3,
    maxPerEvent: 5,
  }) as VideoCardData[];

  const underrated = pickDiverseVideos(nonHeroUnderrated, {
    target: 10,
    maxPerCreator: 2,
    maxPerEvent: 4,
  }) as VideoCardData[];

  const eventsRail: VideoCardData[] = [];
  const seenEvents = new Set<string>();
  for (const video of allCandidates) {
    if (!video.primary_event_id || seenEvents.has(video.primary_event_id)) {
      continue;
    }
    seenEvents.add(video.primary_event_id);
    eventsRail.push(video as VideoCardData);
    if (eventsRail.length >= 12) break;
  }

  const shown = new Set(
    [
      hero?.id,
      ...hot.map((video) => video.id),
      ...fresh.map((video) => video.id),
      ...underrated.map((video) => video.id),
      ...eventsRail.map((video) => video.id),
    ].filter(Boolean),
  );
  const morePool = allCandidates.filter((video) => !shown.has(video.id));
  const more = pickDiverseVideos(
    morePool.length > 0 ? morePool : withoutVideo(allCandidates, hero?.id),
    {
      target: 24,
      maxPerCreator: 4,
      maxPerEvent: 8,
    },
  ) as VideoCardData[];

  return (
    <div className={`fn-public-container ${styles.page}`}>
      <header className={styles.header}>
        <p className="fn-muted fn-text-xs fn-bold">EXPLORE</p>
        <h1 className={styles.title}>次に見る作品を探す</h1>
        <p className={styles.lead}>
          最近の動き、新着、見落としがちな作品、イベント、クリエイター。
          いくつかの切り口で、今見たい一本に出会えるように並べています。
        </p>
      </header>

      <nav className={styles.chips} aria-label="表示カテゴリ">
        {FILTER_CHIPS.map((chip) => (
          <a
            key={chip.href}
            href={chip.href}
            className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
          >
            {chip.icon}
            {chip.label}
          </a>
        ))}
      </nav>

      {hero ? (
        <section className={styles.hero} aria-labelledby="hero-rec">
          <p className="fn-muted fn-text-xs fn-bold" id="hero-rec">
            いま見るなら
          </p>
          <div className={styles.heroCard}>
            <VideoCard video={hero} />
          </div>
        </section>
      ) : (
        <p className={styles.empty}>
          まだおすすめできる作品がありません。
        </p>
      )}

      <Rail
        id="rail-hot"
        title="伸びている"
        subtitle="スコアが高く、最近よく見られている作品"
        items={hot}
        ariaLabel="伸びている作品"
      />

      <Rail
        id="rail-fresh"
        title="新着だけど良さそう"
        subtitle="ここ最近に投稿された新しい作品"
        items={fresh}
        ariaLabel="新着作品"
        moreHref="/list?sort=new"
      />

      <Rail
        id="rail-underrated"
        title="見落としがち"
        subtitle="目立つランキングではないけれど良い作品"
        items={underrated}
        ariaLabel="見落としがちな作品"
      />

      <Rail
        id="rail-events"
        title="イベントから見る"
        subtitle="イベントごとに作品を拾って並べています"
        items={eventsRail}
        ariaLabel="イベントごとの作品"
        moreHref="/event"
      />

      <Rail
        id="rail-more"
        title="まとめて見る"
        subtitle="カテゴリに入りきらなかった公開作品も含めて広めに並べています"
        items={more}
        ariaLabel="さらに探す作品"
        moreHref="/list"
      />

      <section id="rail-creators" className={styles.section}>
        <SectionTitle
          title="クリエイター発見"
          subtitle="投稿数や参加作品からピックアップ"
          moreHref="/user"
        />
        {creators.length === 0 ? (
          <p className={styles.emptyInline}>
            該当するクリエイターがまだいません。
          </p>
        ) : (
          <Shelf ariaLabel="ピックアップクリエイター">
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
      </section>

      <div className={styles.footerCta}>
        <a href={LIST_HREF} className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden />
          一覧でさらに探す
        </a>
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  moreHref,
}: {
  title: string;
  subtitle?: string;
  moreHref?: string;
}): React.ReactElement {
  return (
    <div className="fn-section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle ? (
          <p className="fn-muted fn-text-sm" style={{ margin: "2px 0 0" }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {moreHref ? (
        <a href={moreHref} className="fn-section-more">
          すべて見る -&gt;
        </a>
      ) : null}
    </div>
  );
}

function Rail({
  id,
  title,
  subtitle,
  items,
  ariaLabel,
  moreHref,
}: {
  id: string;
  title: string;
  subtitle?: string;
  items: VideoCardData[];
  ariaLabel: string;
  moreHref?: string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section id={id} className={styles.section}>
      <SectionTitle title={title} subtitle={subtitle} moreHref={moreHref} />
      <Shelf ariaLabel={ariaLabel}>
        {items.map((video, index) => (
          <VideoCard key={`${id}-${video.id}-${index}`} video={video} />
        ))}
      </Shelf>
    </section>
  );
}
