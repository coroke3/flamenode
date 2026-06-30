import * as React from "react";
import Link from "next/link";
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

function buildRail(
  primary: readonly VideoCardData[],
  fallback: readonly VideoCardData[],
  target: number,
  options: { maxPerCreator?: number; maxPerEvent?: number } = {},
): VideoCardData[] {
  return pickDiverseVideos(uniqueVideos([...primary, ...fallback]), {
    target,
    ...options,
  }) as VideoCardData[];
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
      fetchRecommendedVideos(db, 180),
      fetchLatestVideos(db, 120),
      fetchUnderratedVideos(db, 120),
      fetchPickupCreators(db, 60),
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
  const allNonHero = withoutVideo(allCandidates, hero?.id);
  const nonHeroRecommended = withoutVideo(recommended, hero?.id) as VideoCardData[];
  const nonHeroLatest = withoutVideo(latest, hero?.id) as VideoCardData[];
  const nonHeroUnderrated = withoutVideo(
    underratedPool,
    hero?.id,
  ) as VideoCardData[];

  const hot = buildRail(nonHeroRecommended, allNonHero, 18, {
    maxPerCreator: 3,
    maxPerEvent: 5,
  });

  const fresh = buildRail(nonHeroLatest, allNonHero, 18, {
    maxPerCreator: 3,
    maxPerEvent: 5,
  });

  const underrated = buildRail(nonHeroUnderrated, allNonHero, 14, {
    maxPerCreator: 2,
    maxPerEvent: 4,
  });

  const eventsRail: VideoCardData[] = [];
  const seenEvents = new Set<string>();
  for (const video of allNonHero) {
    if (!video.primary_event_id || seenEvents.has(video.primary_event_id)) {
      continue;
    }
    seenEvents.add(video.primary_event_id);
    eventsRail.push(video as VideoCardData);
    if (eventsRail.length >= 16) break;
  }
  if (eventsRail.length < 12) {
    eventsRail.push(
      ...allNonHero
        .filter((video) => !eventsRail.some((shown) => shown.id === video.id))
        .slice(0, 16 - eventsRail.length),
    );
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
    morePool.length > 0 ? morePool : allNonHero,
    {
      target: 36,
      maxPerCreator: 4,
      maxPerEvent: 8,
    },
  ) as VideoCardData[];

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <span className="fn-eyebrow">explore</span>
        <h1 className="fn-display fn-page-title">次に見る作品を探す</h1>
      </header>

      <nav className={`fn-chip-scroll ${styles.chips}`} aria-label="表示カテゴリ">
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
        <section className={`fn-recommend-hero ${styles.hero}`} aria-labelledby="hero-rec">
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
        items={hot}
        ariaLabel="伸びている作品"
      />

      <Rail
        id="rail-fresh"
        title="新着だけど良さそう"
        items={fresh}
        ariaLabel="新着作品"
        moreHref="/list?sort=new"
      />

      <Rail
        id="rail-underrated"
        title="見落としがち"
        items={underrated}
        ariaLabel="見落としがちな作品"
      />

      <Rail
        id="rail-events"
        title="イベントから見る"
        items={eventsRail}
        ariaLabel="イベントごとの作品"
        moreHref="/event"
      />

      <Rail
        id="rail-more"
        title="まとめて見る"
        items={more}
        ariaLabel="さらに探す作品"
        moreHref="/list"
      />

      <section id="rail-creators" className={styles.section}>
        <SectionTitle
          title="クリエイター発見"
          moreHref="/user"
        />
        {creators.length === 0 ? (
          <p className={styles.emptyInline}>
            該当するクリエイターがまだいません。
          </p>
        ) : (
          <Shelf ariaLabel="ピックアップクリエイター" density="compact">
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
        <Link href={LIST_HREF} className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden />
          一覧でさらに探す
        </Link>
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
          <p className="fn-muted fn-text-sm fn-section-subtitle">
            {subtitle}
          </p>
        ) : null}
      </div>
      {moreHref ? (
        <Link href={moreHref} className="fn-section-more">
          すべて見る →
        </Link>
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
