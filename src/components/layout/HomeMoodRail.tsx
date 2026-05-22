import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import {
  type HomeFeatureVideo,
  videoHref,
  videoThumb,
} from "./homeVisuals";
import styles from "./HomeMoodRail.module.css";

/* eslint-disable @next/next/no-img-element */

const MOODS = [
  { label: "静けさ", fallback: "quiet works" },
  { label: "都市", fallback: "city works" },
  { label: "感情", fallback: "emotional works" },
  { label: "実験", fallback: "experimental works" },
];

interface HomeMoodRailProps {
  videos: HomeFeatureVideo[];
}

export function HomeMoodRail({ videos }: HomeMoodRailProps): React.ReactElement {
  return (
    <section className={styles.moodSection} aria-labelledby="sec-mood">
      <div className={styles.moodInner}>
        <div className={styles.moodHeader}>
          <div>
            <h2 id="sec-mood">気分で選ぶ</h2>
            <p>今日の空気に合う映像を、テーマから横断。</p>
          </div>
          <Link href="/recommend" className={styles.moodMore}>
            一覧を見る
            <Icon name="chevron-right" size={14} aria-hidden />
          </Link>
        </div>
        <div className={styles.moodGrid}>
          {MOODS.map((mood, index) => {
            const video = videos[index];
            const thumb = videoThumb(video);
            return (
              <Link
                key={mood.label}
                href={videoHref(video)}
                className={styles.moodCard}
                prefetch={false}
              >
                {thumb ? <img src={thumb} alt="" loading="lazy" /> : null}
                <span className={styles.moodShade} />
                <span className={styles.moodLabel}>{mood.label}</span>
                <span className={styles.moodMeta}>
                  {video?.title ?? mood.fallback}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
