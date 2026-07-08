import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import {
  formatHomeNumber,
  type HomeStats,
} from "./homeVisuals";
import { EventRecruitCard, type RecruitEvent } from "./EventRecruitCard";
import type { HomeIntroSlotStat } from "./HomeIntroBand";

interface HomeTopIntroProps {
  stats: HomeStats;
  primaryEvent: RecruitEvent | null;
  primarySlotStat?: HomeIntroSlotStat;
}

export function HomeTopIntro({
  stats,
  primaryEvent,
  primarySlotStat,
}: HomeTopIntroProps): React.ReactElement {
  return (
    <section className="fn-public-container fn-intro" aria-label="FlameNode">
      <div className="fn-intro-meta">
        <div className="fn-intro-hero">
          <h1 className="fn-display fn-intro-copy">
            映像の、
            <br />
            <span className="fn-intro-copy-accent">結節点。</span>
          </h1>
        </div>
        <p className="fn-intro-lead fn-jp">
          個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。
        </p>
        <div className="fn-intro-stats">
          <div className="fn-stat">
            <span className="fn-stat-v fn-display">
              {formatHomeNumber(stats.publicVideos)}
            </span>
            <span className="fn-stat-k fn-jp">作品</span>
          </div>
          <div className="fn-stat">
            <span className="fn-stat-v fn-display">
              {formatHomeNumber(stats.creators)}
            </span>
            <span className="fn-stat-k fn-jp">クリエイター</span>
          </div>
          <div className="fn-stat">
            <span className="fn-stat-v fn-display">
              {formatHomeNumber(stats.activeEvents)}
            </span>
            <span className="fn-stat-k fn-jp">開催中イベント</span>
          </div>
        </div>
        <div className="fn-intro-actions">
          <Link href="/list" className="fn-btn fn-btn-primary fn-btn-lg">
            作品を見にいく
            <Icon name="chevron-right" size={15} aria-hidden />
          </Link>
          <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-lg">
            イベントを探す
          </Link>
        </div>
      </div>
      {primaryEvent ? (
        <aside className="fn-intro-aside">
          <EventRecruitCard
            event={primaryEvent}
            available={
              primarySlotStat != null ? primarySlotStat.available : null
            }
            total={primarySlotStat != null ? primarySlotStat.total : null}
            variant="primary"
          />
        </aside>
      ) : null}
    </section>
  );
}
