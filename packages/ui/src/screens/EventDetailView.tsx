import React from "react";
import { Image, Link } from "../adapters/index.js";
import { Badge, type BadgeStatus } from "../components/Badge.js";
import { EmptyState } from "../feedback/EmptyState.js";
import { cx } from "../cx.js";
import { Avatar, EXTERNAL, ScreenIcon, VideoCardLink, type ScreenVideoCard } from "./parts.js";

/*
 * Event detail (`/event/[id]`) from the registered mock `docs/migration/mock/static/EventDetail.html`
 * (classes `ed-*`, `metrics`, `split`, styles in `styles/screens.css`). Entry points follow CURRENT
 * `app/(public)/event/[id]/page.tsx`. Display only: the caller passes a public event that already
 * passed the visibility gateway, the status it computed, and which entry action CURRENT would show.
 * Live slot numbers are an Island in MIG-0502; here they are the build-time values.
 */

/** CURRENT shows one entry action: reserve while accepting, submit in the post period, none otherwise. */
export type EventEntryAction = "reserve" | "submit" | null;

export interface EventSlotPart {
  label: string;
  /** null until the live slot status (RH-020) is loaded: the static HTML carries no slot state. */
  filled: number | null;
  total: number;
}

export interface EventStaffMember {
  name: string;
  /** CURRENT `public_role_label ?? "運営"`. */
  roleLabel?: string | null;
  iconUrl?: string | null;
  xUserId?: string | null;
  /** `/user/{id}` only when the member has a public profile. */
  profileHref?: string | null;
}

export interface EventDetailVideo extends Omit<ScreenVideoCard, "href"> {
  id: string;
  youtubeVideoId?: string | null;
}

export interface EventDetailData {
  id: string;
  title: string;
  /** CURRENT `img_url ?? icon_url` for the main visual. */
  imageUrl?: string | null;
  iconUrl?: string | null;
  explanation?: string | null;
  /** `募集期間中` while accepting, else CURRENT `eventStatusLabel(status)`. */
  statusLabel: string;
  statusTone?: BadgeStatus;
  /** e.g. `2026.11.03 – 11.04`. */
  periodLabel?: string | null;
  entryAction: EventEntryAction;
  playlistUrl?: string | null;
  videoTotal: number;
  creatorTotal: number;
  /** null until the live slot status is loaded (shown as `–`). */
  slotFilled: number | null;
  slotTotal: number;
  /** CURRENT `getDayMetric`: label (e.g. `募集締切まで`) and days. */
  dayMetric?: { label: string; days: number } | null;
  /** 募集期間 / 投稿期間 rows. */
  schedule?: readonly { label: string; value: string }[];
  /** CURRENT `buildSlotSummary(...).parts`. */
  slotParts?: readonly EventSlotPart[];
  staff?: readonly EventStaffMember[];
  /** At most CURRENT `EVENT_VIDEO_DISPLAY_LIMIT` public videos. */
  videos?: readonly EventDetailVideo[];
}

export interface EventDetailViewProps {
  /** null when the caller found no public event. */
  event: EventDetailData | null;
  className?: string;
}

/** CURRENT links event videos to `/{youtube id or id}?playlist={event id}`. */
export function eventVideoHref(eventId: string, video: Pick<EventDetailVideo, "id" | "youtubeVideoId">): string {
  const target = video.youtubeVideoId?.trim() || video.id;
  return `/${encodeURIComponent(target)}?playlist=${encodeURIComponent(eventId)}`;
}

function percent(filled: number | null, total: number): number {
  return filled != null && total > 0 ? Math.round((filled / total) * 100) : 0;
}

export function EventDetailView({ event, className }: EventDetailViewProps): React.ReactElement {
  if (!event) {
    return (
      <div className={cx("p-root fn-screen", className)}>
        <main className="wrap scr-empty">
          <EmptyState
            title="イベントが見つかりません"
            description="非公開か、削除されたイベントの可能性があります。"
            action={{ href: "/event", label: "イベント一覧へ" }}
          />
        </main>
      </div>
    );
  }

  const base = `/event/${encodeURIComponent(event.id)}`;
  const videos = event.videos ?? [];
  const slotParts = event.slotParts ?? [];
  const staff = event.staff ?? [];

  return (
    <div className={cx("p-root fn-screen", className)}>
      {event.imageUrl ? <Image className="ed-visual" src={event.imageUrl} alt={`${event.title} メインビジュアル`} /> : null}
      <main className={cx("wrap", !event.imageUrl && "ed-novisual")}>
        <header className="ed-head">
          <div className="row ed-id">
            {event.iconUrl ? <Image className="ev-icon ed-ic" src={event.iconUrl} alt="" width={112} height={112} /> : null}
            <div className="stack ed-titles">
              <span className="wrap-row t-sm ed-status">
                <Badge status={event.statusTone ?? "draft"} label={event.statusLabel} />
                {event.periodLabel ? <span className="muted t-num">{event.periodLabel}</span> : null}
              </span>
              <h1 className="t-display">{event.title}</h1>
            </div>
          </div>
          <div className="actions">
            {event.entryAction === "reserve" ? (
              <Link href={`${base}/slots`} className="fn-btn fn-btn--primary">
                枠を確保する
              </Link>
            ) : event.entryAction === "submit" ? (
              <Link href="/entry" className="fn-btn fn-btn--primary">
                作品を提出する
              </Link>
            ) : null}
            {event.playlistUrl ? (
              <a href={event.playlistUrl} {...EXTERNAL} className="fn-btn fn-btn--secondary">
                YouTube再生リスト
                <ScreenIcon name="external" />
              </a>
            ) : null}
            <Link href="/rules" className="fn-btn fn-btn--tertiary">
              ガイドライン
            </Link>
          </div>
        </header>

        <div className="metrics ed-metrics" role="group" aria-label="イベント概要">
          <Metric value={event.videoTotal.toLocaleString("ja-JP")} label="作品" />
          <Metric value={event.creatorTotal.toLocaleString("ja-JP")} label="クリエイター" />
          <Metric value={`${event.slotFilled ?? "–"} / ${event.slotTotal}`} label="埋まり枠" />
          {event.dayMetric ? <Metric value={`${event.dayMetric.days}日`} label={event.dayMetric.label} /> : null}
        </div>

        <div className="split sec ed-body">
          <div className="main stack">
            {event.explanation ? (
              <section aria-labelledby="ed-about" className="prose">
                <h2 id="ed-about" className="vh">
                  イベント概要
                </h2>
                <p className="ed-explanation">{event.explanation}</p>
              </section>
            ) : null}

            {slotParts.length > 0 ? (
              <section aria-labelledby="ed-slots">
                <div className="sec-head">
                  <h2 id="ed-slots" className="t-h2">
                    上映枠
                  </h2>
                  {event.slotTotal > 0 ? (
                    <Link href={`${base}/slots`} className="ib" aria-label="枠表へ">
                      <ScreenIcon name="arrowRight" />
                    </Link>
                  ) : null}
                </div>
                <div className="stack ed-slots">
                  {slotParts.map((part) => {
                    const pct = percent(part.filled, part.total);
                    return (
                      <div key={part.label} className="stack ed-slot">
                        <div className="row t-sm ed-slot-row">
                          <span>{part.label}</span>
                          <span className="muted t-num">
                            {part.filled ?? "–"} / {part.total}
                          </span>
                        </div>
                        <div
                          className="bar"
                          {...(part.filled != null
                            ? { role: "meter", "aria-label": `${part.label} の埋まり`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }
                            : { "aria-hidden": true })}
                        >
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="ed-posts">
              <div className="sec-head">
                <h2 id="ed-posts" className="t-h2">
                  投稿
                </h2>
                <span className="row">
                  {event.videoTotal > videos.length ? (
                    <Link href={`/list?event=${encodeURIComponent(event.id)}`} className="il t-sm">
                      すべて見る
                      <ScreenIcon name="arrowRight" />
                    </Link>
                  ) : null}
                  <Link href={`${base}/release`} className="ib" aria-label="投稿予定を見る">
                    <ScreenIcon name="calendar" />
                  </Link>
                </span>
              </div>
              {videos.length === 0 ? (
                <p className="muted">このイベントの公開済み作品はまだありません。</p>
              ) : (
                <div className="grid-v">
                  {videos.map((video) => (
                    <VideoCardLink key={video.id} video={{ ...video, href: eventVideoHref(event.id, video) }} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="side stack ed-side">
            {event.schedule && event.schedule.length > 0 ? (
              <section aria-labelledby="ed-schedule">
                <h2 id="ed-schedule" className="vh t-h3">
                  日程
                </h2>
                <dl className="kv ed-kv">
                  {event.schedule.map((row) => (
                    <React.Fragment key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className="t-num">{row.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </section>
            ) : null}
            {staff.length > 0 ? (
              <section aria-labelledby="ed-staff">
                <h2 id="ed-staff" className="vh t-h3">
                  運営
                </h2>
                <ul className="ed-staff">
                  {staff.map((member) => {
                    const body = (
                      <>
                        <Avatar src={member.iconUrl} size={36} />
                        <span className="fn-row__body">
                          <span className="fn-row__title">{member.name}</span>
                          <span className="fn-row__meta">{member.roleLabel || "運営"}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={member.xUserId ?? member.name} className="row ed-staff-row">
                        {member.profileHref ? (
                          <Link href={member.profileHref} className="fn-row fn-row--compact">
                            {body}
                          </Link>
                        ) : (
                          <span className="fn-row fn-row--compact">{body}</span>
                        )}
                        {member.xUserId ? (
                          <a
                            href={`https://x.com/${encodeURIComponent(member.xUserId)}`}
                            {...EXTERNAL}
                            className="ib sm"
                            aria-label={`X (@${member.xUserId}) を開く`}
                          >
                            <ScreenIcon name="x" />
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <div className="metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
