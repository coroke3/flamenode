import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
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

/**
 * 1ページ内で同一作者・同一イベントが出すぎないように制限する diversity フィルタ。
 *
 * - 各 creator は最大 `maxPerCreator` 件、各 primary_event は最大 `maxPerEvent` 件まで。
 * - 順序は維持し、超過した行は削除する。
 */
function limitByCreatorAndEvent<
  T extends { creator_id: string | null; primary_event_id: string | null },
>(
  rows: readonly T[],
  options: { maxPerCreator?: number; maxPerEvent?: number } = {},
): T[] {
  const maxPerCreator = options.maxPerCreator ?? 2;
  const maxPerEvent = options.maxPerEvent ?? 3;
  const creatorCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    const c = r.creator_id ?? "_anon";
    const e = r.primary_event_id ?? "_no_event";
    if ((creatorCounts.get(c) ?? 0) >= maxPerCreator) continue;
    if ((eventCounts.get(e) ?? 0) >= maxPerEvent) continue;
    creatorCounts.set(c, (creatorCounts.get(c) ?? 0) + 1);
    eventCounts.set(e, (eventCounts.get(e) ?? 0) + 1);
    out.push(r);
  }
  return out;
}

interface FilterChip {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const FILTER_CHIPS: FilterChip[] = [
  { href: "#rail-hot", label: "今伸びている", icon: <Icon name="alert" size={11} aria-hidden /> },
  { href: "#rail-fresh", label: "新着", icon: <Icon name="clock" size={11} aria-hidden /> },
  { href: "#rail-underrated", label: "見逃されている", icon: <Icon name="info" size={11} aria-hidden /> },
  { href: "#rail-events", label: "イベント", icon: <Icon name="calendar" size={11} aria-hidden /> },
  { href: "#rail-creators", label: "クリエイター", icon: <Icon name="users" size={11} aria-hidden /> },
];

export default async function RecommendPage(): Promise<React.ReactElement> {
  const data = await withDatabase(async (db) => {
    const [recommended, latest, underrated, creators] = await Promise.all([
      fetchRecommendedVideos(db, 60),
      fetchLatestVideos(db, 30),
      fetchUnderratedVideos(db, 60),
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

  // Hero: 代表作品 1 件
  const hero = recommended[0];

  // Mix rails (PR38 時点では既存データを diversity フィルタで切り分けるだけの軽実装。
  // 真のロジック分離は PR44 で fetchRecommendedVideos を rail 別に作る予定):
  // - hot: video_score 上位 (recommended の先頭) を creator/event diversity 制限で 8 件
  // - fresh: latest を diversity 制限で 8 件
  // - underrated: recommended の後半 (上位ではない) から diversity 制限で 6 件
  // - events: primary_event_id が同じものを 1 件ずつ拾う
  // - creators: 既存の pickup creators
  const hot = limitByCreatorAndEvent(recommended.slice(0, 24), {
    maxPerCreator: 2,
    maxPerEvent: 3,
  }).slice(0, 8) as VideoCardData[];

  const fresh = limitByCreatorAndEvent(latest, {
    maxPerCreator: 2,
    maxPerEvent: 3,
  }).slice(0, 8) as VideoCardData[];

  // 「見逃されている」: fetchUnderratedVideos の候補プールから diversity を強めて 6 件。
  // 投稿日順で並ぶプールに対し creator/event 制限をかけて、同じ顔ぶれを避ける。
  const underrated = limitByCreatorAndEvent(underratedPool, {
    maxPerCreator: 1,
    maxPerEvent: 2,
  }).slice(0, 6) as VideoCardData[];

  // 「イベントから見る」: primary_event_id が異なる作品を 1 件ずつ拾う。
  const eventsRail: VideoCardData[] = [];
  const seenEvents = new Set<string>();
  for (const v of recommended) {
    if (!v.primary_event_id || seenEvents.has(v.primary_event_id)) continue;
    seenEvents.add(v.primary_event_id);
    eventsRail.push(v as VideoCardData);
    if (eventsRail.length >= 8) break;
  }

  return (
    <div className={`fn-public-container ${styles.page}`}>
      <header className={styles.header}>
        <p className="fn-muted fn-text-xs fn-bold">EXPLORE</p>
        <h1 className={styles.title}>次に見る作品を探す</h1>
        <p className={styles.lead}>
          最近の動き、新着、見逃されがちな作品、イベント、クリエイター。
          いくつかの切り口で並べています。気になる棚から流し見してください。
        </p>
      </header>

      {/* フィルターチップ: 各棚へのアンカー導線。黄色は使わず薄ボタンで控えめに */}
      <nav className={styles.chips} aria-label="表示カテゴリ">
        {FILTER_CHIPS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
          >
            {c.icon}
            {c.label}
          </Link>
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
        <p className={styles.empty}>まだおすすめできる作品がありません。</p>
      )}

      <Rail
        id="rail-hot"
        title="今伸びている"
        subtitle="スコアが高く、最近よく見られている作品"
        items={hot}
        ariaLabel="今伸びている作品"
      />

      <Rail
        id="rail-fresh"
        title="新着だけど良さそう"
        subtitle="ここ最近に投稿された新作"
        items={fresh}
        ariaLabel="新着作品"
        moreHref="/list?sort=new"
      />

      <Rail
        id="rail-underrated"
        title="見逃されている"
        subtitle="目立つランクではないけれど良い作品"
        items={underrated}
        ariaLabel="見逃されている作品"
      />

      <Rail
        id="rail-events"
        title="イベントから見る"
        subtitle="各イベントから 1 件ずつ"
        items={eventsRail}
        ariaLabel="イベントごとの作品"
        moreHref="/event"
      />

      <section id="rail-creators" className={styles.section}>
        <SectionTitle
          title="クリエイター発見"
          subtitle="投稿量や合作活動からピックアップ"
          moreHref="/user"
        />
        {creators.length === 0 ? (
          <p className={styles.emptyInline}>
            該当するクリエイターがまだいません。
          </p>
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
      </section>

      <div className={styles.footerCta}>
        <Link href="/list" className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden /> 一覧でさらに探す
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
          <p className="fn-muted fn-text-sm" style={{ margin: "2px 0 0" }}>
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
        {items.map((v, index) => (
          <VideoCard key={`${id}-${v.id}-${index}`} video={v} />
        ))}
      </Shelf>
    </section>
  );
}
