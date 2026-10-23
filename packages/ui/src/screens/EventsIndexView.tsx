import React from "react";
import { Image, Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { ScreenIcon } from "./parts.js";

/*
 * Event list (`/event`) from the registered mock `docs/migration/mock/static/Events.html`
 * (classes `ev-srch`, `seg`, `field-i`, `sel-i`, `sec`, `grid-v3`, `ev-visual`, styles in `styles/events.css`).
 * Texts, filter keys and section rules follow CURRENT `app/(public)/event/EventIndexView.tsx`; the caller
 * (`apps/site/src/lib/eventIndex.ts`) computes the model, so the build and the browser Island share it.
 * The search form is a plain GET form: `/event?q=&status=&sort=` is served by the same static page and the
 * Island reads the query, so reload and back/forward behave as the URL says.
 */

export interface EventCardView {
  id: string;
  title: string;
  imageUrl: string | null;
  iconUrl: string | null;
  statusLabel: string;
  statusTone: "ok" | "info" | "mute";
  dateLabel: string;
}

export interface EventsIndexSectionView {
  key: string;
  anchorId?: string;
  title: string;
  subtitle?: string;
  iconUrl?: string | null;
  description?: string | null;
  accentStyle?: Readonly<Record<string, string>>;
  count: string;
  events: readonly EventCardView[];
  emptyText?: string;
}

export interface EventsIndexViewModel {
  query: { q: string; status: string; sort: string };
  total: number;
  chips: readonly { value: string; label: string; href: string; active: boolean }[];
  showReset: boolean;
  sections: readonly EventsIndexSectionView[];
  emptyMessage: string | null;
}

export interface EventsIndexViewProps {
  model: EventsIndexViewModel;
  className?: string;
}

export const EVENT_SORT_OPTIONS = [
  { value: "priority", label: "おすすめ順" },
  { value: "deadline", label: "応募締切順" },
  { value: "start", label: "開始日順" },
  { value: "new", label: "新着順" },
] as const;

export function EventCard({ event }: { event: EventCardView }): React.ReactElement {
  return (
    <Link href={`/event/${event.id}`} className="ev-visual">
      {event.imageUrl ? <Image src={event.imageUrl} alt="" /> : <span className="ev-visual-ph" aria-hidden="true" />}
      <div className="row ev-card-body">
        {event.iconUrl ? <Image className="ev-icon" src={event.iconUrl} alt="" width={48} height={48} /> : null}
        <div className="stack ev-card-text">
          <span className="ev-card-title">{event.title}</span>
          <span className="row t-sm muted ev-card-meta">
            <span className="st ev-card-status">
              <i className={`st-ic ${event.statusTone}`} aria-hidden="true">
                <span className="st-dot" />
              </i>
              {event.statusLabel}
            </span>
            <span className="t-num">{event.dateLabel}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

function SectionBlock({ section }: { section: EventsIndexSectionView }): React.ReactElement {
  return (
    <section
      id={section.anchorId}
      className={cx("sec ev-sec", section.accentStyle && "ev-group")}
      aria-label={section.title}
      style={section.accentStyle as React.CSSProperties | undefined}
    >
      <div className="sec-head">
        <div className="row ev-sec-head">
          {section.iconUrl ? <Image className="ev-icon ev-sec-icon" src={section.iconUrl} alt="" width={32} height={32} /> : null}
          <h2 className="t-h2">{section.title}</h2>
          {section.subtitle ? <span className="t-sm muted">{section.subtitle}</span> : null}
          <span className="t-num muted t-sm">{section.count}</span>
        </div>
      </div>
      {section.description ? <p className="ev-sec-desc">{section.description}</p> : null}
      {section.events.length === 0 ? (
        <p className="ev-sec-desc">{section.emptyText}</p>
      ) : (
        <div className="grid-v3">
          {section.events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

export function EventsIndexView({ model, className }: EventsIndexViewProps): React.ReactElement {
  const { query } = model;
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap ev-scope ev-index">
        <span className="t-sm muted">EVENTS</span>
        <h1 className="t-display">イベントを探す</h1>
        <p className="muted ev-lead">{model.total} events</p>

        <form role="search" method="get" action="/event" className="wrap-row ev-srch">
          <nav className="seg" aria-label="イベントの状態">
            {model.chips.map((chip) => (
              <a key={chip.value} href={chip.href} aria-current={chip.active ? "page" : undefined}>
                {chip.label}
              </a>
            ))}
          </nav>
          <span className="ev-srch-spacer" />
          <label className="field-i sm-field ev-srch-field">
            <span className="vh">イベントを検索</span>
            <input
              type="search"
              name="q"
              className="select"
              defaultValue={query.q}
              key={`q-${query.q}`}
              placeholder="イベント名・説明・公開運営者を検索"
              autoComplete="off"
            />
            <ScreenIcon name="search" />
          </label>
          <input type="hidden" name="status" value={query.status} />
          <label className="sel-i" title="並び替え">
            <ScreenIcon name="sort" />
            <span className="vh">並び替え</span>
            <select
              name="sort"
              className="select i"
              defaultValue={query.sort}
              key={`sort-${query.sort}`}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              {EVENT_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="fn-btn fn-btn--secondary fn-btn--sm">
            検索
          </button>
          {model.showReset ? (
            <Link href="/event" className="fn-btn fn-btn--tertiary fn-btn--sm">
              リセット
            </Link>
          ) : null}
        </form>

        {model.emptyMessage ? (
          <div className="ev-empty">
            <p>{model.emptyMessage}</p>
          </div>
        ) : (
          model.sections.map((section) => <SectionBlock key={section.key} section={section} />)
        )}
      </main>
    </div>
  );
}
