import React from "react";
import { Link } from "../adapters/index.js";
import { Pagination } from "../data/Pagination.js";
import { EmptyState } from "../feedback/EmptyState.js";
import { cx } from "../cx.js";
import { Avatar, EXTERNAL, ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * Creator profile (`/user/[id]`) from the registered mock `docs/migration/mock/static/Creator.html`
 * (classes `cr-wrap`, `pf-head`, `split`, styles in `styles/screens.css`). Entry points follow CURRENT
 * `app/(public)/user/[id]/UserProfilePage.tsx` (`StaticUserProfileView`). Display only: the caller
 * passes a public profile, the current page of works / collabs and the page hrefs CURRENT builds
 * (page 1 = bare profile URL, else `?worksPage=` / `?collabPage=`).
 */

export interface CreatorSocialLink {
  /** Accessible name, e.g. `Web サイト` (CURRENT `formatSocialLinkLabel`). */
  label: string;
  url: string;
}

export interface CreatorVideoPage {
  items: readonly ScreenVideoCard[];
  total: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  buildHref: (page: number) => string;
}

export interface CreatorProfileData {
  /** X user ID; the profile URL key. */
  id: string;
  /** CURRENT `x_name || id`. */
  name: string;
  iconUrl?: string | null;
  youtubeChannelUrl?: string | null;
  /** Other header links (CURRENT `profileHeaderSocialLinks`). `mailto:` opens in place. */
  socialLinks?: readonly CreatorSocialLink[];
  profileText?: string | null;
  contact?: string | null;
  works: CreatorVideoPage;
  collabs: CreatorVideoPage;
}

export interface CreatorViewProps {
  /** null when the caller found no public profile. */
  creator: CreatorProfileData | null;
  className?: string;
}

export function CreatorView({ creator, className }: CreatorViewProps): React.ReactElement {
  if (!creator) {
    return (
      <div className={cx("p-root fn-screen", className)}>
        <main className="wrap scr-empty">
          <EmptyState
            title="クリエイターが見つかりません"
            description="非公開か、存在しないクリエイターの可能性があります。"
            action={{ href: "/user", label: "クリエイター一覧へ" }}
          />
        </main>
      </div>
    );
  }

  const base = `/user/${encodeURIComponent(creator.id)}`;
  const { works, collabs } = creator;

  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap cr-wrap">
        <Link href="/user" className="il t-sm muted">
          <ScreenIcon name="arrowLeft" />
          クリエイター一覧
        </Link>
        <header className="pf-head">
          <Avatar src={creator.iconUrl} size={160} className="pf-av" />
          <div className="stack pf-titles">
            <h1 className="t-display">{creator.name}</h1>
            <span className="row pf-links">
              <a
                href={`https://x.com/${encodeURIComponent(creator.id)}`}
                {...EXTERNAL}
                className="ib"
                aria-label={`X @${creator.id}`}
              >
                <ScreenIcon name="x" />
              </a>
              {creator.youtubeChannelUrl ? (
                <a href={creator.youtubeChannelUrl} {...EXTERNAL} className="ib" aria-label="YouTube">
                  <ScreenIcon name="youtube" />
                </a>
              ) : null}
              {(creator.socialLinks ?? []).map((link) => (
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
              <span className="t-sm muted pf-handle">@{creator.id}</span>
            </span>
          </div>
        </header>

        <div className="split cr-body">
          <div className="main stack cr-main">
            <section aria-labelledby="works">
              <div className="sec-head">
                <h2 id="works" className="t-h2">
                  作品 <span className="t-num muted cr-count">{works.total}</span>
                </h2>
                <Link href={`${base}/portfolio`} className="ib" aria-label="ポートフォリオ表示">
                  <ScreenIcon name="idCard" />
                </Link>
              </div>
              {works.items.length === 0 ? (
                <p className="muted">まだ公開されている作品がありません。</p>
              ) : (
                <>
                  <div className="grid-v">
                    {works.items.map((video, index) => (
                      <VideoCardLink key={`${video.href}-${index}`} video={video} />
                    ))}
                  </div>
                  <Pagination
                    className="cr-pager"
                    currentPage={works.currentPage}
                    totalPages={works.totalPages}
                    total={works.total}
                    pageSize={works.pageSize}
                    buildHref={works.buildHref}
                    unitLabel="件"
                  />
                </>
              )}
            </section>

            {collabs.total > 0 ? (
              <section aria-labelledby="collab">
                <h2 id="collab" className="t-h2 cr-collab-h">
                  参加作品 <span className="t-num muted cr-count">{collabs.total}</span>
                </h2>
                <div className="grid-v">
                  {collabs.items.map((video, index) => (
                    <VideoCardLink key={`${video.href}-${index}`} video={video} />
                  ))}
                </div>
                <Pagination
                  className="cr-pager"
                  currentPage={collabs.currentPage}
                  totalPages={collabs.totalPages}
                  total={collabs.total}
                  pageSize={collabs.pageSize}
                  buildHref={collabs.buildHref}
                  unitLabel="件"
                />
              </section>
            ) : null}
          </div>

          {creator.profileText || creator.contact ? (
            <aside className="side stack cr-side">
              {creator.profileText ? (
                <section aria-labelledby="cr-about">
                  <h2 id="cr-about" className="vh t-h3">
                    About
                  </h2>
                  <p className="muted">{creator.profileText}</p>
                </section>
              ) : null}
              {creator.contact ? (
                <section aria-labelledby="cr-contact">
                  <h2 id="cr-contact" className="vh t-h3">
                    Contact
                  </h2>
                  <p className="muted">{creator.contact}</p>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
