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

/**
 * 1ページ内で同一作者・同一イベントが出すぎないようにする soft diversity フィルタ。
 *
 * まず偏りを抑えて選び、件数が足りなければ元の順序から補充する。
 * primary_event_id が null の作品は「同一イベント」として数えない。
 */
function pickDiverseVideos<
  T extends { id: string; creator_x_user_id?: string | null; primary_event_id?: string | null },
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

  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const c = r.creator_x_user_id;
    const e = r.primary_event_id;
    if (c && (creatorCounts.get(c) ?? 0) >= maxPerCreator) {
      skipped.push(r);
      continue;
    }
    if (e && (eventCounts.get(e) ?? 0) >= maxPerEvent) {
      skipped.push(r);
      continue;
    }
    seen.add(r.id);
    if (c) creatorCounts.set(c, (creatorCounts.get(c) ?? 0) + 1);
    if (e) eventCounts.set(e, (eventCounts.get(e) ?? 0) + 1);
    out.push(r);
    if (out.length >= target) return out;
  }

  for (const r of skipped) {
    if (out.length >= target) break;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
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

function withoutVideo<T extends { id: string }>(rows: readonly T[], id?: string): T[] {
  return id ? rows.filter((row) => row.id !== id) : [...rows];
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
  { href: "#rail-more", label: "まとめて見る", icon: <Icon name="grid" size={11} aria-hidden /> },
  { href: "#rail-creators", label: "クリエイター", icon: <Icon name="users" size={11} aria-hidden /> },
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

  // Hero: 代表作品 1 件
  const hero = recommended[0] ?? latest[0] ?? underratedPool[0];
  const nonHeroRecommended = withoutVideo(recommended, hero?.id);
  const nonHeroLatest = withoutVideo(latest, hero?.id);
  const nonHeroUnderrated = withoutVideo(underratedPool, hero?.id);

  // Mix rails (PR38 時点では既存データを diversity フィルタで切り分けるだけの軽実装。
  // 真のロジック分離は PR44 で fetchRecommendedVideos を rail 別に作る予定):
  // - hot: video_stats.score 上位を creator/event diversity 制限で 12 件
  // - fresh: latest を diversity 制限で 12 件
  // - underrated: 低スコア/新しめの候補を diversity 制限で 10 件
  // - events: primary_event_id が同じものを 1 件ずつ拾う
  // - more: 各候補を混ぜ、表示件数不足を防ぐ探索棚
  // - creators: 既存の pickup creators
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

  // 「見逃されている」: fetchUnderratedVideos の候補プールから diversity をやや強めて 10 件。
  // 投稿日順で並ぶプールに対し creator/event 制限をかけて、同じ顔ぶれを避ける。
  const underrated = pickDiverseVideos(nonHeroUnderrated, {
    target: 10,
    maxPerCreator: 2,
    maxPerEvent: 4,
  }) as VideoCardData[];

  // 「イベントから見る」: primary_event_id が異なる作品を 1 件ずつ拾う。
  const eventsRail: VideoCardData[] = [];
  const seenEvents = new Set<string>();
  for (const v of allCandidates) {
    if (!v.primary_event_id || seenEvents.has(v.primary_event_id)) continue;
    seenEvents.add(v.primary_event_id);
    eventsRail.push(v as VideoCardData);
    if (eventsRail.length >= 12) break;
  }

  const shown = new Set([
    hero?.id,
    ...hot.map((v) => v.id),
    ...fresh.map((v) => v.id),
    ...underrated.map((v) => v.id),
    ...eventsRail.map((v) => v.id),
  ].filter(Boolean));
  const morePool = allCandidates.filter((v) => !shown.has(v.id));
  const more = pickDiverseVideos(morePool.length > 0 ? morePool : withoutVideo(allCandidates, hero?.id), {
    target: 24,
    maxPerCreator: 4,
    maxPerEvent: 8,
  }) as VideoCardData[];

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
          <a
            key={c.href}
            href={c.href}
            className="fn-btn fn-btn-ghost fn-btn-soft-outline fn-btn-sm"
          >
            {c.icon}
            {c.label}
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
        <a href={LIST_HREF} className="fn-btn fn-btn-primary">
          <Icon name="grid" size={14} aria-hidden /> 一覧でさらに探す
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
          すべて見る →
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
        {items.map((v, index) => (
          <VideoCard key={`${id}-${v.id}-${index}`} video={v} />
        ))}
      </Shelf>
    </section>
  );
}
