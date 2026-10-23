import React from "react";
import { Image, Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * `/list` from the registered mock `docs/migration/mock/static/Videos.html` (`grid-v`, `fn-vc`) with CURRENT
 * `app/(public)/list/ListIndexView.tsx` texts and its three display modes (tile / compact / index table).
 * Display only: the caller passes the rows of one page already filtered to public videos. The search form, sort,
 * view switch, active-filter chips and pagination all need the query string at run time; they are Islands
 * (MIG-0507) and are not rendered here, so this static view has no control that does nothing.
 */
export type ListViewMode = "grid" | "compact" | "index";

export interface ListVideo extends ScreenVideoCard {
  id: string;
  /** Index table: CURRENT `primary_event_id` / title (`イベント` when untitled). */
  eventId?: string | null;
  eventTitle?: string | null;
  /** Index table: CURRENT `formatUnix(scheduled_time, { dateOnly: true })`. */
  dateLabel?: string | null;
}

export interface ListViewProps {
  videos: readonly ListVideo[];
  total: number;
  view?: ListViewMode;
  /** CURRENT `listEmptyMessage`, chosen by the caller. */
  emptyMessage: string;
  className?: string;
}

export function ListView({ videos, total, view = "grid", emptyMessage, className }: ListViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap lv-wrap">
        <header className="row lv-head">
          <div className="stack lv-titles">
            <p className="t-label muted">ARCHIVE</p>
            <h1 className="t-display">作品一覧</h1>
          </div>
          <span className="t-sm muted t-num">{`${total.toLocaleString("en-US")} works`}</span>
        </header>

        {videos.length === 0 ? (
          <p className="muted lv-empty" role="status">
            <ScreenIcon name="info" /> {emptyMessage}
          </p>
        ) : view === "index" ? (
          <div className="t-scroll lv-tbl-wrap">
            <table className="lv-tbl">
              <thead>
                <tr>
                  <th aria-label="サムネイル" />
                  <th>作品</th>
                  <th>クリエイター</th>
                  <th>イベント</th>
                  <th>公開日</th>
                  <th aria-label="open" />
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id}>
                    <td className="lv-thumb">
                      {v.thumbnailUrl ? <Image src={v.thumbnailUrl} alt="" /> : <span className="lv-thumb-empty" aria-hidden="true"><ScreenIcon name="youtube" /></span>}
                    </td>
                    <td><Link href={v.href} className="lv-title">{v.title}</Link></td>
                    <td className="muted">{v.creatorName}</td>
                    <td>
                      {v.eventId ? (
                        <Link href={`/event/${encodeURIComponent(v.eventId)}`}>{v.eventTitle ?? "イベント"}</Link>
                      ) : (
                        <span aria-label="イベントなし">—</span>
                      )}
                    </td>
                    <td className="t-num muted">{v.dateLabel}</td>
                    <td>
                      <Link href={v.href} className="ib sm" aria-label={`${v.title}を開く`}><ScreenIcon name="arrowRight" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={cx("grid-v lv-grid", view === "compact" && "lv-compact")}>
            {videos.map((v) => (
              <VideoCardLink key={v.id} video={v} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
