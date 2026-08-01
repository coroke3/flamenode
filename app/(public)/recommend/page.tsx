import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { Shelf } from "@/components/layout/Shelf";
import { Icon } from "@/components/ui/Icon";
import styles from "./page.module.css";
import { buildPageMetadata } from "@/lib/seo";
import {
  isDegradedD1Mode,
  loadStaticRecommendPage,
  setPublicRequestRoute,
} from "@/lib/publicData/loader";
import { buildRecommendViewModel } from "@/lib/publicData/staticRecommendCore";

export const metadata: Metadata = buildPageMetadata({
  path: "/recommend",
  title: "おすすめ作品",
  description:
    "FlameNodeの注目作品、新着作品、見つけてほしい映像をまとめて紹介します。",
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
    label: "人気作品",
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
];

export default async function RecommendPage(): Promise<React.ReactElement> {
  setPublicRequestRoute("/recommend");
  const staticLoaded = await loadStaticRecommendPage();
  const isDegraded = isDegradedD1Mode(staticLoaded.mode);
  const pools = staticLoaded.recommend;

  const {
    hero,
    hot,
    fresh,
    underrated,
    eventsRail,
    more,
  } = pools
    ? buildRecommendViewModel(pools)
    : {
        hero: undefined,
        hot: [] as VideoCardData[],
        fresh: [] as VideoCardData[],
        underrated: [] as VideoCardData[],
        eventsRail: [] as VideoCardData[],
        more: [] as VideoCardData[],
      };

  const visibleFresh = isDegraded ? fresh.slice(0, 12) : fresh;

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <span className="fn-eyebrow">explore</span>
        <h1 className="fn-display fn-page-title">次に見る作品を探す</h1>
      </header>

      {!isDegraded ? (
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
      ) : null}

      {!isDegraded && hero ? (
        <section className={`fn-recommend-hero ${styles.hero}`} aria-labelledby="hero-rec">
          <p className="fn-muted fn-text-xs fn-bold" id="hero-rec">
            いま見るなら
          </p>
          <div className={styles.heroCard}>
            <VideoCard video={hero} />
          </div>
        </section>
      ) : !isDegraded ? (
        <p className={styles.empty}>
          まだおすすめできる作品がありません。
        </p>
      ) : null}

      {!isDegraded ? (
        <>
          <Rail
            id="rail-hot"
            title="人気作品"
            items={hot}
            ariaLabel="人気作品"
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
        </>
      ) : null}

      <Rail
        id="rail-fresh"
        title={isDegraded ? "新着" : "新着だけど良さそう"}
        items={visibleFresh}
        ariaLabel="新着作品"
        moreHref="/list?sort=new"
      />

      <div className={styles.footerCta}>
        <Link href={LIST_HREF} className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden />
          一覧でさらに探す
        </Link>
      </div>
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
