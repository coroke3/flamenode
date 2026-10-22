import React from "react";
import { Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import type { CreatorSocialLink } from "./CreatorView.js";
import { Avatar, EXTERNAL, ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * Portfolio (`/user/[id]/portfolio`) from the registered mock `docs/migration/mock/static/Portfolio.html`
 * (`metrics`, `pf-works`, About / Contact columns). Texts and entry points follow CURRENT
 * `app/(public)/user/[id]/portfolio/page.tsx`. The mock's own logo header is not drawn: CURRENT sits
 * under the shared public header. Display only; the caller passes the first `workLimit` works.
 */

export interface PortfolioData {
  /** X user ID; the profile URL key. */
  id: string;
  /** CURRENT `x_name || id`. */
  name: string;
  iconUrl?: string | null;
  youtubeChannelUrl?: string | null;
  socialLinks?: readonly CreatorSocialLink[];
  profileText?: string | null;
  contact?: string | null;
  works: readonly ScreenVideoCard[];
  totalWorks: number;
  /** CURRENT `WORK_LIMIT`: "すべて見る" appears when `totalWorks` exceeds it. */
  workLimit: number;
}

export interface PortfolioViewProps {
  portfolio: PortfolioData;
  className?: string;
}

export function PortfolioView({ portfolio, className }: PortfolioViewProps): React.ReactElement {
  const base = `/user/${encodeURIComponent(portfolio.id)}`;
  const hasProfile = Boolean(portfolio.profileText || portfolio.contact);
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap pfo-wrap">
        <div className="row pfo-nav">
          <Link href={base} className="il t-sm muted">
            <ScreenIcon name="arrowLeft" />@{portfolio.id} の公開プロフィール
          </Link>
          <Link href="/user" className="ib sm pfo-close" aria-label="一覧へ戻る">
            ×
          </Link>
        </div>

        <section className="pfo-hero">
          <div className="row pfo-who">
            <Avatar src={portfolio.iconUrl} size={64} className="pf-av pfo-av" />
            <div className="stack pfo-titles">
              <span className="t-label muted">Portfolio</span>
              <h1 className="t-display">{portfolio.name}</h1>
            </div>
          </div>
          <div className="metrics" aria-label="Portfolio stats">
            <div className="metric">
              <b>{portfolio.totalWorks.toLocaleString("en-US")}</b>
              <span>Works</span>
            </div>
          </div>
        </section>

        <section className="sec" aria-labelledby="portfolio-works-heading">
          <div className="sec-head">
            <h2 id="portfolio-works-heading" className="vh">
              Works
            </h2>
            {portfolio.totalWorks > portfolio.workLimit ? (
              <Link href={base} className="il t-sm muted">
                すべて見る
              </Link>
            ) : null}
          </div>
          {portfolio.works.length > 0 ? (
            <div className="pf-works">
              {portfolio.works.map((video, index) => (
                <VideoCardLink key={`${video.href}-${index}`} video={video} />
              ))}
            </div>
          ) : (
            <p className="muted">まだ公開されている作品がありません。</p>
          )}
        </section>

        <section className="sec pfo-profile" aria-label="プロフィール">
          <div className="stack pfo-col">
            <h2 className="vh t-h3">About</h2>
            {portfolio.profileText ? (
              <p className="muted">{portfolio.profileText}</p>
            ) : hasProfile ? null : (
              <p className="muted">このポートフォリオには、まだプロフィール項目が登録されていません。</p>
            )}
          </div>
          <div className="stack pfo-col">
            <h2 className="vh t-h3">Contact</h2>
            {portfolio.contact ? <p className="muted">{portfolio.contact}</p> : null}
            <span className="row pf-links">
              <a
                href={`https://x.com/${encodeURIComponent(portfolio.id)}`}
                {...EXTERNAL}
                className="ib"
                aria-label={`X @${portfolio.id}`}
              >
                <ScreenIcon name="x" />
              </a>
              {portfolio.youtubeChannelUrl ? (
                <a href={portfolio.youtubeChannelUrl} {...EXTERNAL} className="ib" aria-label="YouTube">
                  <ScreenIcon name="youtube" />
                </a>
              ) : null}
              {(portfolio.socialLinks ?? []).map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  {...(link.url.startsWith("mailto:") ? {} : EXTERNAL)}
                  className="ib"
                  aria-label={link.label}
                >
                  <ScreenIcon name="globe" />
                </a>
              ))}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
