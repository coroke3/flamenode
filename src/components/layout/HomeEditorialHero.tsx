import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import {
  formatHomeNumber,
  type HomeFeatureVideo,
  type HomeStats,
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
  const visualVideos = videos.slice(0, 3).map((video) => ({
    video,
    thumb: videoThumb(video),
  }));

  return (
    <section className={styles.editorialHero} aria-label="FlameNode">
      <div className={styles.heroRail} aria-hidden>
        <span>SCROLL</span>
        <i />
        <span>01</span>
      </div>

      <div className={styles.heroCopy}>
        <p className={styles.heroEyebrow}>flamenode / node.0426</p>
        <h1 className={styles.heroTitle}>
          Video
          <br />
          <span className={styles.heroAccent}>Nodes</span>
        </h1>
        <p className={styles.heroLead}>
          映像の結節点。個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。
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
          <a href={LIST_HREF} className="fn-btn fn-btn-primary fn-btn-lg">
            作品を見る
            <Icon name="chevron-right" size={15} aria-hidden />
          </a>
          <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-lg">
            イベントを探す
          </Link>
        </div>

        {visualVideos.length > 0 ? (
          <div className={styles.heroPreviewGrid} aria-hidden>
            {visualVideos.map(({ video, thumb }, index) => (
              <div key={`${video.id}-hero-preview-${index}`} className={styles.heroPreview}>
                {thumb ? <img src={thumb} alt="" /> : <span>FN</span>}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
