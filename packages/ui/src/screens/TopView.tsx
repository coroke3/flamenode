import React from "react";
import { Image, Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * `/` from the registered mock `docs/migration/mock/static/Main.html` (hero event, `sec`, `shelf`, `fn-vc`) with
 * CURRENT `app/(public)/page.tsx` + `HomeTopIntro` / `HomeIntroBand` / `HomeClosingCta` texts, sections and order.
 * The shelves are horizontal scrollers that stream to the screen edge (owner decision). Native scroll works without
 * script; the endless loop, auto-scroll, hover pause and arrow buttons are the MIG-0507 Island, so no arrow
 * buttons are drawn here. Display only: everything comes from the build snapshot.
 */
export interface TopStats {
  publicVideos: number;
  creators: number;
  activeEvents: number;
}

/** CURRENT `EventRecruitCard` model: state, countdown and slot fill, computed by the caller at build time. */
export interface TopRecruit {
  id: string;
  title: string;
  statusLabel: string;
  kind: "pre" | "entry" | "submit" | "ended";
  imageUrl?: string | null;
  countdownHeading: string;
  countdownRange: string;
  /** `formatRemainingTimeMetric`; null renders an em dash. */
  countdownValue?: string | null;
  countdownUnit?: string | null;
  slotFilled?: number | null;
  slotTotal?: number | null;
  ctaHref: string;
  ctaLabel: string;
}

export interface TopShelfItem extends ScreenVideoCard {
  id: string;
  rank?: number;
}

export interface TopShelf {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  moreHref: string;
  moreLabel: string;
  items: readonly TopShelfItem[];
  /** CURRENT `EmptyShelf` message. */
  emptyMessage: string;
}

export interface TopEventCard {
  id: string;
  title: string;
  statusLabel: string;
  tone: "accent" | "warn" | "muted";
  rangeLabel: string;
  imageUrl?: string | null;
}

export interface TopAnnouncement {
  id: string;
  title: string;
  body: string;
}

export interface TopViewProps {
  stats: TopStats;
  primary?: TopRecruit | null;
  recruits: readonly TopRecruit[];
  /** CURRENT `すべてのイベントを見る ({n}件)`; null when there is nothing more. */
  moreRecruitCount?: number | null;
  announcements: readonly TopAnnouncement[];
  /** Trending first (only when it has items), then picks, latest, nostalgic: CURRENT order. */
  shelves: readonly TopShelf[];
  events: readonly TopEventCard[];
  eventsEmptyMessage: string;
  className?: string;
}

const num = (n: number): string => new Intl.NumberFormat("ja-JP").format(n);

function Recruit({ event, primary }: { event: TopRecruit; primary?: boolean }): React.ReactElement {
  const pct =
    event.slotTotal != null && event.slotTotal > 0 && event.slotFilled != null
      ? Math.max(0, Math.min(100, Math.round((event.slotFilled / event.slotTotal) * 100)))
      : 0;
  return (
    <article className={cx("tp-rec", primary && "tp-rec-primary")} data-kind={event.kind} aria-label={`${event.title} ${event.statusLabel}`}>
      {event.imageUrl ? (
        <Link href={`/event/${event.id}`} className="tp-rec-visual">
          <Image src={event.imageUrl} alt={`${event.title} メインビジュアル`} />
        </Link>
      ) : null}
      <div className="stack tp-rec-body">
        <span className="t-sm tp-rec-code">{event.id.toUpperCase()}</span>
        <Link href={`/event/${event.id}`} className="t-h2 tp-rec-status">
          {event.statusLabel}
        </Link>
        <h2 className="t-h3 tp-rec-title">{event.title}</h2>
        <div className="stack tp-rec-count">
          <span className="t-sm muted">
            {event.countdownHeading} <span className="t-num">{event.countdownRange}</span>
          </span>
          <span className="tp-rec-num t-num">
            {event.countdownValue ?? "—"}
            {event.countdownValue && event.countdownUnit ? <small>{event.countdownUnit}</small> : null}
          </span>
        </div>
        <div className="stack tp-rec-slots">
          <span className="t-sm t-num">
            埋まり枠 {event.slotFilled ?? "-"}
            {event.slotTotal != null ? `/${event.slotTotal}` : ""}
          </span>
          <div className="bar" role="meter" aria-label={`埋まり枠 ${event.slotFilled ?? 0}/${event.slotTotal ?? 0}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="actions">
          <Link href={event.ctaHref} className="fn-btn fn-btn--primary">
            {event.ctaLabel} →
          </Link>
        </div>
      </div>
    </article>
  );
}

export function TopView({ stats, primary, recruits, moreRecruitCount, announcements, shelves, events, eventsEmptyMessage, className }: TopViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen tp", className)}>
      <main>
        <section className="wrap tp-intro" aria-label="FlameNode">
          <div className="stack tp-copy">
            <h1 className="t-display">
              映像の、
              <br />
              <span className="tp-accent">結節点。</span>
            </h1>
            <p className="tp-lead">個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。</p>
            <div className="metrics" role="group" aria-label="FlameNode の現在">
              <div className="metric"><b>{num(stats.publicVideos)}</b><span>作品</span></div>
              <div className="metric"><b>{num(stats.creators)}</b><span>クリエイター</span></div>
              <div className="metric"><b>{num(stats.activeEvents)}</b><span>開催中イベント</span></div>
            </div>
            <div className="actions">
              <Link href="/list" className="fn-btn fn-btn--primary">
                作品を見にいく
                <ScreenIcon name="arrowRight" />
              </Link>
              <Link href="/event" className="fn-btn fn-btn--tertiary">
                イベントを探す
              </Link>
            </div>
          </div>
          {primary ? (
            <aside className="tp-aside">
              <Recruit event={primary} primary />
            </aside>
          ) : null}
        </section>

        {announcements.length > 0 ? (
          <section className="wrap tp-news" aria-label="お知らせ">
            {announcements.map((item) => (
              <article key={item.id} className="stack tp-news-item">
                <strong>{item.title}</strong>
                <p className="muted t-sm">{item.body}</p>
              </article>
            ))}
          </section>
        ) : null}

        {recruits.length > 0 ? (
          <section className="wrap tp-recruits" aria-label="注目イベント">
            <div className="tp-recruit-row">
              {recruits.map((event) => (
                <Recruit key={event.id} event={event} />
              ))}
            </div>
            {moreRecruitCount != null ? (
              <Link href="/event" className="fn-btn fn-btn--tertiary fn-btn--sm">
                <ScreenIcon name="calendar" />
                すべてのイベントを見る ({moreRecruitCount}件)
              </Link>
            ) : null}
          </section>
        ) : null}

        {shelves.map((shelf) => (
          <section key={shelf.id} className="sec tp-sec" aria-labelledby={`sec-${shelf.id}`}>
            <div className="wrap">
              <header className="sec-head">
                <div className="stack">
                  <p className="t-label muted">{shelf.eyebrow}</p>
                  <h2 id={`sec-${shelf.id}`} className="t-h2">{shelf.title}</h2>
                  {shelf.description ? <span className="t-sm muted">{shelf.description}</span> : null}
                </div>
                <Link href={shelf.moreHref} className="il t-sm muted">
                  {shelf.moreLabel}
                  <ScreenIcon name="arrowRight" />
                </Link>
              </header>
            </div>
            {shelf.items.length === 0 ? (
              <div className="wrap"><p className="muted tp-empty">{shelf.emptyMessage}</p></div>
            ) : (
              <div className="shelf" data-shelf={shelf.id} role="region" aria-label={shelf.title} tabIndex={0}>
                <ol className="shelf-track">
                  {shelf.items.map((item, index) => (
                    <li key={`${item.id}-${index}`} className="shelf-i">
                      {item.rank != null ? <span className="shelf-rank t-num" aria-hidden="true">{item.rank}</span> : null}
                      <VideoCardLink video={item} />
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        ))}

        <section className="wrap sec tp-sec" aria-labelledby="sec-events">
          <header className="sec-head">
            <div className="stack">
              <p className="t-label muted">EVENTS</p>
              <h2 id="sec-events" className="t-h2">最近のイベント</h2>
            </div>
            <Link href="/event" className="il t-sm muted">
              イベント一覧
              <ScreenIcon name="arrowRight" />
            </Link>
          </header>
          {events.length === 0 ? (
            <p className="muted tp-empty">{eventsEmptyMessage}</p>
          ) : (
            <div className="grid-v">
              {events.map((event) => (
                <Link key={event.id} href={`/event/${event.id}`} className="scr-card tp-evcard">
                  {event.imageUrl ? <Image className="tp-evposter" src={event.imageUrl} alt="" /> : <span className="tp-evposter" aria-hidden="true" />}
                  <span className="row t-sm tp-evtop">
                    <span className="st" data-tone={event.tone}>{event.statusLabel}</span>
                    <span className="muted t-num">{event.rangeLabel}</span>
                  </span>
                  <h3 className="t-h3">{event.title}</h3>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="wrap sec tp-closing" aria-label="FlameNode のイベント">
          <p className="t-display">Upload your frame.</p>
          <p className="muted">あなたのフレームをアーカイブに残す。</p>
          <div className="actions">
            <Link href="/entry" className="fn-btn fn-btn--primary">新規投稿を始める →</Link>
            <Link href="/about" className="fn-btn fn-btn--tertiary">FlameNodeについて</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
