import React from "react";
import { Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * `/recommend` from the registered mock `docs/migration/mock/static/Recommend.html` (`seg` tabs, `sec`, `grid-v`)
 * with CURRENT `app/(public)/recommend/page.tsx` texts, rails and order. The mock tabs filter in place (an Island);
 * CURRENT's category chips are in-page anchors, which work without script, so those are kept.
 */
export interface RecommendRail {
  id: "rail-hot" | "rail-underrated" | "rail-events" | "rail-more" | "rail-fresh";
  title: string;
  ariaLabel: string;
  items: readonly (ScreenVideoCard & { id: string })[];
  /** CURRENT `すべて見る →` link. */
  moreHref?: string;
}

export interface RecommendViewProps {
  hero?: (ScreenVideoCard & { id: string }) | null;
  /** In CURRENT order; empty rails are skipped as CURRENT does. */
  rails: readonly RecommendRail[];
  className?: string;
}

const CHIPS = [
  { href: "#rail-hot", label: "人気作品" },
  { href: "#rail-fresh", label: "新着" },
  { href: "#rail-underrated", label: "見落としがち" },
  { href: "#rail-events", label: "イベント" },
  { href: "#rail-more", label: "まとめて見る" },
] as const;

export function RecommendView({ hero, rails, className }: RecommendViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap rc-wrap">
        <header className="stack rc-head">
          <p className="t-label muted">explore</p>
          <h1 className="t-display">次に見る作品を探す</h1>
        </header>

        <nav className="seg rc-tabs" aria-label="表示カテゴリ">
          {CHIPS.map((chip) => (
            <a key={chip.href} href={chip.href}>{chip.label}</a>
          ))}
        </nav>

        {hero ? (
          <section className="sec rc-hero" aria-labelledby="hero-rec">
            <p className="t-sm muted" id="hero-rec">いま見るなら</p>
            <div className="rc-hero-card">
              <VideoCardLink video={hero} />
            </div>
          </section>
        ) : (
          <p className="muted rc-empty">まだおすすめできる作品がありません。</p>
        )}

        {rails
          .filter((rail) => rail.items.length > 0)
          .map((rail) => (
            <section key={rail.id} id={rail.id} className="sec" aria-label={rail.ariaLabel}>
              <div className="sec-head">
                <h2 className="t-h2">{rail.title}</h2>
                {rail.moreHref ? (
                  <Link href={rail.moreHref} className="il t-sm">
                    すべて見る →
                  </Link>
                ) : null}
              </div>
              <div className="grid-v">
                {rail.items.map((video, index) => (
                  <VideoCardLink key={`${rail.id}-${video.id}-${index}`} video={video} />
                ))}
              </div>
            </section>
          ))}

        <div className="rc-cta">
          <Link href="/list" className="fn-btn fn-btn--primary">
            <ScreenIcon name="arrowRight" />
            一覧でさらに探す
          </Link>
        </div>
      </main>
    </div>
  );
}
