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
  const primaryVisual = videos[0];
  const secondaryVisual = videos[1];
  const thirdVisual = videos[2];
  const primaryThumb = videoThumb(primaryVisual);
  const secondaryThumb = videoThumb(secondaryVisual);
  const thirdThumb = videoThumb(thirdVisual);

  return (
    <section className={styles.editorialHero} aria-label="FlameNode">
      <div className={styles.heroRail} aria-hidden>
        <span>SCROLL</span>
        <i />
        <span>01</span>
      </div>

      <div className={styles.heroCopy}>
        <p className={styles.heroEyebrow}>CREATIVE ARCHIVE / 2026</p>
        <h1 className={styles.heroTitle}>
          FlameNode
          <br />
          つくる人が、
          <br />
          <span className={styles.heroAccent}>つながる場所。</span>
        </h1>
        <p className={styles.heroLead}>
          個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。
          作品、クリエイター、上映企画をひとつの流れでつなぎます。
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
            作品を見にいく
            <Icon name="chevron-right" size={15} aria-hidden />
          </a>
          <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-lg">
            イベントを探す
          </Link>
        </div>
      </div>

      <div className={styles.heroVisual} aria-hidden>
        <div className={styles.visualBackdrop} />
        <div className={styles.visualCard}>
          {primaryThumb ? (
            <img src={primaryThumb} alt="" />
          ) : (
            <span className={styles.visualFallback}>FlameNode</span>
          )}
        </div>
        <div className={styles.visualPanel}>
          <span>Play</span>
          <span>Create</span>
          <span>Connect</span>
        </div>
        <div className={styles.visualMini}>
          {secondaryThumb ? <img src={secondaryThumb} alt="" /> : null}
        </div>
        <div className={styles.visualTile}>
          {thirdThumb ? <img src={thirdThumb} alt="" /> : null}
        </div>
        <div className={styles.visualPulse} />
      </div>
    </section>
  );
}
