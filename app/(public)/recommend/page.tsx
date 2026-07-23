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
import { buildPageMetadata } from "@/lib/seo";
import {
  canFallbackToDatabase,
  loadStaticRecommendPage,
} from "@/lib/publicData/loader";
import {
  buildRecommendViewModel,
  type StaticRecommendPools,
} from "@/lib/publicData/staticRecommendCore";

export const metadata: Metadata = buildPageMetadata({
  path: "/recommend",
  title: "おすすめ",
});
export const dynamic = "force-dynamic";

const LIST_HREF = "/list";

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

async function fetchRecommendPoolsFromDatabase(): Promise<StaticRecommendPools | null> {
  return withDatabase(async (db) => {
    const [recommended, latest, underrated, creators] = await Promise.all([
      fetchRecommendedVideos(db, 180),
      fetchLatestVideos(db, 120),
      fetchUnderratedVideos(db, 120),
      fetchPickupCreators(db, 60),
    ]);
    return {
      generatedAt: null,
      recommended: recommended as VideoCardData[],
      latest: latest as VideoCardData[],
      underrated: underrated as VideoCardData[],
      creators: creators.map((creator) => ({
        id: creator.id,
        x_name: creator.x_name,
        icon_url: creator.icon_url,
        video_count: Number(creator.video_count) || 0,
        collab_count: Number(creator.collab_count) || 0,
      })),
    };
  });
}

export default async function RecommendPage(): Promise<React.ReactElement> {
  const staticLoaded = await loadStaticRecommendPage();
  const pools =
    staticLoaded.recommend ??
    (canFallbackToDatabase(staticLoaded.strategy)
      ? await fetchRecommendPoolsFromDatabase()
      : null);

  const {
    hero,
    hot,
    fresh,
    underrated,
    eventsRail,
    more,
    creators,
  } = pools
    ? buildRecommendViewModel(pools)
    : {
        hero: undefined,
        hot: [],
        fresh: [],
        underrated: [],
        eventsRail: [],
        more: [],
        creators: [],
      };

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
          <Shelf ariaLabel="ピックアップクリエイター" density="compact" mobileRows={1}>
            {creators.map((creator, index) => (
              <CreatorCard
                key={`${creator.id}-creator-${index}`}
                data={{
                  id: creator.id,
                  x_name: creator.x_name,
                  icon_url: creator.icon_url,
                  video_count: creator.video_count + creator.collab_count,
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
