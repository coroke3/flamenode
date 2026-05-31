import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import {
  formatHomeNumber,
  type HomeFeatureVideo,
  type HomeStats,
  videoHref,
  videoThumb,
} from "./homeVisuals";
import styles from "./HomeEditorialHero.module.css";

/* eslint-disable @next/next/no-img-element */

interface HomeEditorialHeroProps {
  stats: HomeStats;
  videos: HomeFeatureVideo[];
}

const LIST_HREF = "/list";

export function HomeEditorialHero({
  stats,
  videos,
}: HomeEditorialHeroProps): React.ReactElement {
  const visualVideos = videos.slice(0, 4).map((video) => ({
    video,
    thumb: videoThumb(video),
  }));
  const mainVisual = visualVideos[0] ?? null;
  const supportVisuals = visualVideos.slice(1, 4);

  return (
    <section className={styles.editorialHero} aria-label="FlameNode">
      <div className={styles.heroRail} aria-hidden>
        <span>SCROLL</span>
        <i />
        <span>01</span>
      </div>

      <div className={styles.heroCopy}>
        <p className={styles.heroEyebrow}>creative network / 2026</p>
        <h1 className={styles.heroTitle}>
          つくる人が、
          <br />
          つながる前に、
          <br />
          <span className={styles.heroAccent}>惹かれあう場所。</span>
        </h1>
        <p className={styles.heroLead}>
          映像を投稿する。イベントに出会う。仲間と混ざる。
          FlameNodeは、創作のはじまりをデザインするプラットフォームです。
        </p>

        <dl className={styles.heroStats}>
          <div>
            <dt>公開作品</dt>
            <dd>{formatHomeNumber(stats.publicVideos)}</dd>
          </div>
          <div>
            <dt>開催中イベント</dt>
            <dd>{formatHomeNumber(stats.activeEvents)}</dd>
          </div>
          <div>
            <dt>クリエイター</dt>
            <dd>{formatHomeNumber(stats.creators)}</dd>
          </div>
        </dl>

        <div className={styles.heroActions}>
          <Link href={LIST_HREF} className="fn-btn fn-btn-primary fn-btn-lg">
            作品を見にいく
            <Icon name="chevron-right" size={15} aria-hidden />
          </Link>
          <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-lg">
            イベントを探す
          </Link>
        </div>
      </div>

      <div className={styles.heroVisual} aria-label="注目作品">
        <div className={styles.visualBackplate} aria-hidden />
        <Link
          href={videoHref(mainVisual?.video)}
          className={styles.visualMain}
          prefetch={false}
        >
          {mainVisual?.thumb ? (
            <img src={mainVisual.thumb} alt="" loading="eager" />
          ) : (
            <span>FlameNode</span>
          )}
          <span className={styles.visualPlay}>
            <Icon name="play" size={18} aria-hidden />
          </span>
          <span className={styles.visualCaption}>
            Play
            <br />
            Create
            <br />
            Connect
          </span>
        </Link>
        <div className={styles.visualSide}>
          {supportVisuals.map(({ video, thumb }, index) => (
            <Link
              key={`${video.id}-hero-side-${index}`}
              href={videoHref(video)}
              className={styles.visualThumb}
              prefetch={false}
            >
              {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span>FN</span>}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
