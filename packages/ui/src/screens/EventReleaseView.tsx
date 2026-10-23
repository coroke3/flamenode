import React from "react";
import { Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { Avatar, EXTERNAL, ScreenIcon } from "./parts.js";

/*
 * Event release (`/event/[id]/release`) from the registered mock `docs/migration/mock/static/EventRelease.html`
 * (classes `rl-*`, styles in `styles/events.css`). Texts, date grouping, list/grid/creator modes follow CURRENT
 * `app/(public)/event/[id]/release/ReleaseView.tsx`. The caller (`apps/site/src/lib/eventRelease.ts`) prepares the
 * rows; the mode is state of the Island (URL hash `#list | #grid | #creator`), the server HTML is the list mode.
 */

export type ReleaseMode = "list" | "grid" | "creator";

export interface ReleaseMemberView {
  name: string;
  xUserId: string | null;
  role: string | null;
  comment: string | null;
  key: string;
}

export interface ReleaseVideoView {
  id: string;
  title: string;
  timeLabel: string;
  collab: boolean;
  part: string | null;
  creatorName: string;
  creatorXUserId: string | null;
  creatorIconUrl: string | null;
  detailHref: string;
  watchHref: string | null;
  thumbnailUrl: string | null;
  introComment: string | null;
  members: readonly ReleaseMemberView[];
}

export interface ReleaseDateGroup {
  /** CURRENT `YYYY/MM/DD` or `日時未定`. */
  date: string;
  videos: readonly ReleaseVideoView[];
}

export interface EventReleaseViewModel {
  eventId: string;
  eventTitle: string;
  groups: readonly ReleaseDateGroup[];
  videos: readonly ReleaseVideoView[];
  truncated: boolean;
}

export interface EventReleaseViewProps {
  model: EventReleaseViewModel;
  mode: ReleaseMode;
  onModeChange?: (mode: ReleaseMode) => void;
  className?: string;
}

function MemberLine({ video }: { video: ReleaseVideoView }): React.ReactElement {
  return (
    <span className="il">
      <ScreenIcon name="group" />
      メンバー:{" "}
      {video.members.map((member, index) => (
        <span key={member.key}>
          {member.xUserId ? (
            <a href={`https://x.com/${encodeURIComponent(member.xUserId)}`} {...EXTERNAL}>
              {member.name}
            </a>
          ) : (
            member.name
          )}
          {member.role ? ` (${member.role})` : ""}
          {member.comment ? ` — ${member.comment}` : ""}
          {index < video.members.length - 1 ? " / " : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * CURRENT `ListScrollBand`: the comment / member line scrolls only when it overflows (not with reduced motion),
 * 3 s after load, at 50 px/s. Server HTML and first render show the single static copy.
 */
function ReleaseTicker({ video }: { video: ReleaseVideoView }): React.ReactElement | null {
  const hasComment = Boolean(video.introComment?.trim());
  const hasMembers = video.members.length > 0;
  const boxRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLSpanElement>(null);
  const [scrollSec, setScrollSec] = React.useState<number | null>(null);
  React.useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const overflow = inner.offsetWidth > box.clientWidth;
    setScrollSec(overflow && !reduced ? inner.offsetWidth / 50 : null);
  }, [video]);
  if (!hasComment && !hasMembers) return null;
  const copy = (
    <>
      {hasComment ? <span>{video.introComment}</span> : null}
      {hasComment && hasMembers ? <span className="sp" /> : null}
      {hasMembers ? <MemberLine video={video} /> : null}
    </>
  );
  return (
    <div className="rl-tickbox" ref={boxRef}>
      <span
        className="rl-tick"
        data-scroll={scrollSec != null ? "true" : undefined}
        style={scrollSec != null ? { animationDuration: `${scrollSec}s`, animationDelay: "3s" } : undefined}
      >
        <span ref={innerRef}>{copy}</span>
        {scrollSec != null ? (
          <>
            <span className="sp" aria-hidden="true" />
            <span aria-hidden="true">{copy}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}

function ListRow({ video }: { video: ReleaseVideoView }): React.ReactElement {
  return (
    <div className="rl-wrap rl-wrap-row">
      <div className="rl-item">
        <span className="t-num rl-time">{video.timeLabel}</span>
        <span className="rl-type t-sm">
          <ScreenIcon name={video.collab ? "group" : "user"} />
          {video.collab ? "複数人" : "個人"}
          {video.part ? <span className="muted">{video.part}</span> : null}
        </span>
        <Avatar src={video.creatorIconUrl} size={40} />
        <span className="c-cre rl-cre">{video.creatorName}</span>
        <span className="rl-title">{video.title}</span>
        <span className="c-act row">
          {video.watchHref ? (
            <a href={video.watchHref} {...EXTERNAL} className="il t-sm">
              視聴
            </a>
          ) : null}
          <Link href={video.detailHref} className="il t-sm">
            詳細
          </Link>
        </span>
      </div>
      <ReleaseTicker video={video} />
    </div>
  );
}

function GridTile({ video, date }: { video: ReleaseVideoView; date: string }): React.ReactElement {
  return (
    <div
      className="rl-tile"
      style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined}
    >
      <div className="ov">
        <div className="stack rl-tile-top">
          <span className="t-sm muted t-num">{date}</span>
          <span className="t-num rl-tile-time">{video.timeLabel}</span>
          {video.part ? <span className="t-sm">{video.part}</span> : null}
        </div>
        <div className="stack rl-tile-bottom">
          <div className="row rl-tile-cre">
            <Avatar src={video.creatorIconUrl} size={60} />
            <span>{video.creatorName}</span>
          </div>
          <span className="rl-tile-title">{video.title}</span>
          {video.introComment ? <span className="t-sm muted">{video.introComment}</span> : null}
          <div className="act">
            {video.watchHref ? (
              <a href={video.watchHref} {...EXTERNAL} className="il t-sm">
                YouTubeで視聴する
              </a>
            ) : null}
            <Link href={video.detailHref} className="il t-sm">
              詳細を見る
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function XLink({ xUserId }: { xUserId: string | null }): React.ReactElement | null {
  if (!xUserId) return null;
  return (
    <a
      href={`https://x.com/${encodeURIComponent(xUserId)}`}
      {...EXTERNAL}
      className="ib sm"
      aria-label={`X (@${xUserId}) を開く`}
    >
      <ScreenIcon name="x" />
    </a>
  );
}

function CreatorMode({ videos }: { videos: readonly ReleaseVideoView[] }): React.ReactElement {
  const individuals = videos.filter((v) => !v.collab);
  const groups = videos.filter((v) => v.collab);
  return (
    <div className="stack rl-creator">
      {individuals.length > 0 ? (
        <section>
          <h2 className="rl-h">
            <span className="rl-pt">個人参加</span>
            <span className="t-sm muted t-num">{individuals.length}組</span>
          </h2>
          <div className="rl-people">
            {individuals.map((video) => (
              <div key={video.id} className="rl-person">
                <Avatar src={video.creatorIconUrl} size={96} />
                <Link href={video.detailHref}>{video.creatorName}</Link>
                <XLink xUserId={video.creatorXUserId} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {groups.length > 0 ? (
        <section>
          <h2 className="rl-h">
            <span className="rl-pt">グループ参加</span>
            <span className="t-sm muted t-num">{groups.length}組</span>
          </h2>
          {groups.map((video) => (
            <div key={video.id} className="rl-team">
              <Avatar src={video.creatorIconUrl} size={48} />
              <div className="rl-team-b">
                <div className="rl-team-h">
                  <Link href={video.detailHref} className="rl-team-n">
                    {video.creatorName}
                  </Link>
                  <XLink xUserId={video.creatorXUserId} />
                </div>
                {video.members.length > 0 ? (
                  <div className="rl-mem">
                    {video.members.map((member, i) =>
                      member.xUserId ? (
                        <a
                          key={member.key}
                          href={`https://x.com/${encodeURIComponent(member.xUserId)}`}
                          {...EXTERNAL}
                          className={cx("rl-m", i === video.members.length - 1 && "last")}
                        >
                          {member.name}
                        </a>
                      ) : (
                        <span key={member.key} className={cx("rl-m", i === video.members.length - 1 && "last")}>
                          {member.name}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

const MODES: readonly { mode: ReleaseMode; label: string; icon: "list" | "image" | "user" }[] = [
  { mode: "list", label: "リスト表示", icon: "list" },
  { mode: "grid", label: "カード表示", icon: "image" },
  { mode: "creator", label: "作者別表示", icon: "user" },
];

export function EventReleaseView({ model, mode, onModeChange, className }: EventReleaseViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap ev-scope ev-release">
        <Link href={`/event/${encodeURIComponent(model.eventId)}`} className="il t-sm muted">
          <ScreenIcon name="arrowLeft" />
          {model.eventTitle}
        </Link>
        <h1 className="t-display ev-release-title">投稿予定のご案内</h1>

        <nav className="row ev-release-modes" aria-label="作品表示モード">
          {MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              className={cx("ib", mode === item.mode && "on")}
              aria-label={item.label}
              aria-pressed={mode === item.mode}
              onClick={() => onModeChange?.(item.mode)}
            >
              <ScreenIcon name={item.icon} />
            </button>
          ))}
        </nav>
        {model.truncated ? <p className="ev-note">先頭500作品を表示</p> : null}

        {model.videos.length === 0 ? (
          <p className="ev-empty">公開中の作品はありません。</p>
        ) : mode === "creator" ? (
          <CreatorMode videos={model.videos} />
        ) : mode === "grid" ? (
          <div className="ev-release-body">
            {model.groups.map((group) => (
              <section key={group.date} className="ev-release-day">
                <h2 className="rl-h">
                  <span className="rl-hd t-num">{group.date}</span>
                </h2>
                <div className="rl-grid">
                  {group.videos.map((video) => (
                    <GridTile key={video.id} video={video} date={group.date} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="ev-release-body">
            {model.groups.map((group) => (
              <section key={group.date} className="ev-release-day">
                <h2 className="rl-h">
                  <span className="rl-hd t-num">{group.date}</span>
                </h2>
                <div className="rl-body">
                  {group.videos.map((video) => (
                    <ListRow key={video.id} video={video} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
