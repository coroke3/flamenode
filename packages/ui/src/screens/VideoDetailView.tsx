import React from "react";
import { Image, Link } from "../adapters/index.js";
import { Badge, type BadgeStatus } from "../components/Badge.js";
import { EmptyState } from "../feedback/EmptyState.js";
import { TableScroll } from "../data/TableScroll.js";
import { cx } from "../cx.js";
import { Avatar, EXTERNAL, ScreenIcon } from "./parts.js";

/*
 * Video detail (`/[id]`) from the registered mock `docs/migration/mock/static/VideoDetail.html`
 * (classes `vd-*`, styles in `styles/screens.css`). Entry points follow CURRENT
 * `app/(public)/[id]/page.tsx`. Display only: the caller passes public data that already passed
 * the visibility gateway (MIG-0405) and every href decision CURRENT makes from data
 * (e.g. the profile link only for creators with a public profile). Player, like/save,
 * chapter seek, member sort/view switch and the viewer dock are Islands (MIG-0507); this
 * component only leaves slots for them.
 */

export interface VideoDetailCreator {
  name: string;
  /** CURRENT `creator_x_user_id`; shown as `@id` and used for the X link. */
  xUserId?: string | null;
  iconUrl?: string | null;
  /** `/user/{id}` only when the creator has a public profile (CURRENT `creatorHref`), else null. */
  profileHref?: string | null;
  youtubeChannelUrl?: string | null;
}

export interface VideoDetailEvent {
  id: string;
  title: string;
  iconUrl?: string | null;
  /** CURRENT `eventStatusLabel(computeEventStatus(event))`. */
  statusLabel?: string | null;
  statusTone?: BadgeStatus;
  /** CURRENT `isAcceptingEntries(event)` adds a separate 受付中 badge. */
  accepting?: boolean;
  /** Only when the event has a YouTube playlist. */
  playlistUrl?: string | null;
}

export interface VideoDetailMember {
  id: string;
  name: string;
  xUserId?: string | null;
  iconUrl?: string | null;
  role?: string | null;
  comment?: string | null;
  /** `/user/{id}` only when the member has a public profile. */
  profileHref?: string | null;
  /** Chapter times (e.g. `0:24`) linked to this member. */
  chapterTimes?: readonly string[];
}

export interface VideoDetailChapter {
  id: string;
  timeLabel: string;
  label: string;
  authorName?: string | null;
  /** `member` = member part, `comment` = viewer chapter comment (mock icon only). */
  kind?: "member" | "comment";
}

export interface VideoDetailRelated {
  href: string;
  title: string;
  creatorName?: string | null;
  thumbnailUrl?: string | null;
}

export interface VideoDetailData {
  id: string;
  title: string;
  creator: VideoDetailCreator;
  /** e.g. `2026.03.29` (CURRENT formats `scheduled_time` date only). */
  publishedLabel?: string | null;
  /** Poster for the player placeholder. */
  thumbnailUrl?: string | null;
  hasYoutube: boolean;
  music?: string | null;
  credit?: string | null;
  musicReferenceUrl?: string | null;
  introComment?: string | null;
  softwareLabel?: string | null;
  highlights?: string | null;
  productionStory?: string | null;
  closingComment?: string | null;
  primaryEvent?: VideoDetailEvent | null;
  /** Other public events, without the primary one. */
  otherEvents?: readonly { id: string; title: string }[];
  members?: readonly VideoDetailMember[];
  chapters?: readonly VideoDetailChapter[];
  related?: readonly VideoDetailRelated[];
  /** CURRENT shows a degraded notice when the shared related data is unavailable. */
  relatedUnavailable?: boolean;
  likeCount?: number;
}

export interface VideoDetailViewProps {
  /** null when the caller found no public video; the gateway decides, not this view. */
  video: VideoDetailData | null;
  /** YouTube player Island (CURRENT `YoutubePlayer` + `VideoViewTracker`). */
  player?: React.ReactNode;
  /** Like / save Island (CURRENT `VideoInteractionActions`). */
  interactions?: React.ReactNode;
  /** Member table Island with sort and table/card switch (CURRENT `MemberSection`). */
  members?: React.ReactNode;
  /** Chapter list Island with seek, composer and viewer dock (CURRENT `VideoViewerUtilityDock`). */
  chapters?: React.ReactNode;
  className?: string;
}

/** CURRENT `RelatedList firstCount`. */
export const VIDEO_RELATED_LIMIT = 12;

export function VideoDetailView({
  video,
  player,
  interactions,
  members,
  chapters,
  className,
}: VideoDetailViewProps): React.ReactElement {
  if (!video) {
    return (
      <div className={cx("p-root fn-screen", className)}>
        <div className="wrap scr-empty">
          <EmptyState
            title="作品が見つかりません"
            description="非公開か、削除された作品の可能性があります。"
            action={{ href: "/list", label: "作品一覧へ" }}
          />
        </div>
      </div>
    );
  }

  const { creator } = video;
  const memberRows = video.members ?? [];
  const chapterRows = video.chapters ?? [];
  const related = (video.related ?? []).slice(0, VIDEO_RELATED_LIMIT);
  const hasDetailComments = Boolean(video.highlights || video.productionStory || video.closingComment);
  const musicText = video.music ? `${video.music}${video.credit ? ` / ${video.credit}` : ""}` : null;
  const creatorBlock = (
    <>
      <Avatar src={creator.iconUrl} size={40} />
      <span className="stack">
        <span>{creator.name}</span>
        <span className="t-sm muted t-num">
          {[creator.xUserId ? `@${creator.xUserId}` : null, video.publishedLabel ? `公開 ${video.publishedLabel}` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </>
  );

  return (
    <div className={cx("p-root fn-screen vd", className)}>
      <div className="vd-layout">
        <main className="vd-main">
          <div className="vd-hero">
            <div className="vd-player-pane" data-island="video-player">
              {player ?? (
                <div className="vd-player">
                  {video.hasYoutube && video.thumbnailUrl ? (
                    <Image className="cover" src={video.thumbnailUrl} alt="" />
                  ) : (
                    <p className="vd-player-empty">
                      {video.hasYoutube
                        ? "プレイヤーを読み込んでいます。"
                        : "YouTube動画は未登録ですが、作品情報を公開しています。"}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="vd-info">
              <h1 className="t-display vd-title">{video.title}</h1>

              <div className="wrap-row vd-creator-row">
                {creator.profileHref ? (
                  <Link href={creator.profileHref} className="row vd-creator">
                    {creatorBlock}
                  </Link>
                ) : (
                  <span className="row vd-creator">{creatorBlock}</span>
                )}
                {creator.profileHref || creator.xUserId || creator.youtubeChannelUrl ? (
                  <span className="row vd-links" role="group" aria-label="投稿者へのリンク">
                    {creator.profileHref ? (
                      <Link href={creator.profileHref} className="ib sm" aria-label="FlameNode のプロフィールを開く">
                        <ScreenIcon name="user" />
                      </Link>
                    ) : null}
                    {creator.xUserId ? (
                      <a
                        href={`https://x.com/${encodeURIComponent(creator.xUserId)}`}
                        {...EXTERNAL}
                        className="ib sm"
                        aria-label={`X (@${creator.xUserId}) を開く`}
                      >
                        <ScreenIcon name="x" />
                      </a>
                    ) : null}
                    {creator.youtubeChannelUrl ? (
                      <a href={creator.youtubeChannelUrl} {...EXTERNAL} className="ib sm" aria-label="YouTube チャンネルを開く">
                        <ScreenIcon name="youtube" />
                      </a>
                    ) : null}
                  </span>
                ) : null}
                <span className="vd-spacer" />
                <span className="row vd-acts" data-island="video-interactions">
                  {interactions ?? (
                    <span className="vd-like-count il t-num" aria-label={`いいね ${video.likeCount ?? 0}件`}>
                      <ScreenIcon name="heart" />
                      {video.likeCount ?? 0}
                    </span>
                  )}
                </span>
              </div>

              {video.primaryEvent ? (
                <div className="wrap-row vd-event">
                  {video.primaryEvent.iconUrl ? (
                    <Image className="ev-icon" src={video.primaryEvent.iconUrl} alt="" width={24} height={24} />
                  ) : null}
                  <Link href={`/event/${encodeURIComponent(video.primaryEvent.id)}`}>{video.primaryEvent.title}</Link>
                  {video.primaryEvent.statusLabel ? (
                    <Badge status={video.primaryEvent.statusTone ?? "draft"} label={video.primaryEvent.statusLabel} />
                  ) : null}
                  {video.primaryEvent.accepting ? <Badge status="public" label="受付中" /> : null}
                  <span className="vd-spacer" />
                  {video.primaryEvent.playlistUrl ? (
                    <a href={video.primaryEvent.playlistUrl} {...EXTERNAL} className="il t-sm">
                      <ScreenIcon name="youtube" />
                      YouTube再生リスト
                      <ScreenIcon name="external" />
                    </a>
                  ) : null}
                </div>
              ) : null}

              {video.otherEvents && video.otherEvents.length > 0 ? (
                <div className="wrap-row t-sm vd-other-events" role="group" aria-label="その他の所属イベント">
                  <span className="muted">他の所属</span>
                  {video.otherEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={`/event/${encodeURIComponent(event.id)}`}
                      className="fn-btn fn-btn--secondary fn-btn--sm"
                    >
                      {event.title}
                    </Link>
                  ))}
                </div>
              ) : null}

              <section aria-label="作品情報" className="vd-about">
                {video.introComment ? <p className="vd-intro">{video.introComment}</p> : null}
                {musicText || video.softwareLabel ? (
                  <div className="meta-i">
                    {musicText ? (
                      video.musicReferenceUrl ? (
                        <a href={video.musicReferenceUrl} {...EXTERNAL}>
                          <ScreenIcon name="music" />
                          <span className="fn-sr-only">楽曲: </span>
                          {musicText}
                          <ScreenIcon name="external" />
                        </a>
                      ) : (
                        <span>
                          <ScreenIcon name="music" />
                          <span className="fn-sr-only">楽曲: </span>
                          {musicText}
                        </span>
                      )
                    ) : null}
                    {video.softwareLabel ? (
                      <span>
                        <ScreenIcon name="software" />
                        <span className="fn-sr-only">使用ソフト: </span>
                        {video.softwareLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {hasDetailComments ? (
                  <details className="vd-details">
                    <summary className="il t-sm">
                      <ScreenIcon name="chevronDown" />
                      詳細コメント
                    </summary>
                    <dl className="kv">
                      {video.highlights ? (
                        <>
                          <dt>みどころ</dt>
                          <dd>{video.highlights}</dd>
                        </>
                      ) : null}
                      {video.productionStory ? (
                        <>
                          <dt>制作エピソード</dt>
                          <dd>{video.productionStory}</dd>
                        </>
                      ) : null}
                      {video.closingComment ? (
                        <>
                          <dt>あとがき</dt>
                          <dd>{video.closingComment}</dd>
                        </>
                      ) : null}
                    </dl>
                  </details>
                ) : null}
              </section>

              {members ?? (memberRows.length > 0 ? <MemberTable members={memberRows} /> : null)}
            </div>
          </div>
        </main>

        <aside className="vd-side" aria-label="作品の補足情報">
          {chapters ?? (
            <section aria-labelledby="vd-ch" className="vd-panel" data-island="video-chapters">
              <div className="row vd-panel-head">
                <h2 id="vd-ch" className="t-h3">
                  チャプター <span className="muted t-num">{chapterRows.length}</span>
                </h2>
              </div>
              {chapterRows.length > 0 ? (
                <ol className="vd-chapters">
                  {chapterRows.map((chapter) => (
                    <li key={chapter.id} className="fn-row vd-chapter">
                      <span className="t-num vd-chapter-time">{chapter.timeLabel}</span>
                      <span className="fn-row__body">
                        <span className="fn-row__title">{chapter.label}</span>
                        {chapter.authorName ? (
                          <span className="fn-row__meta il">
                            <ScreenIcon name={chapter.kind === "comment" ? "comment" : "group"} />
                            {chapter.authorName}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="t-sm muted vd-panel-note">チャプターはまだありません。</p>
              )}
            </section>
          )}

          <section aria-labelledby="vd-rel">
            <h2 id="vd-rel" className="vh t-h3">
              関連動画
            </h2>
            {video.relatedUnavailable ? (
              <p className="t-sm muted" role="status">
                関連動画用の共有データを一時的に利用できません。時間をおいて再読み込みしてください。
              </p>
            ) : related.length === 0 ? (
              <p className="t-sm muted">関連動画はまだありません。</p>
            ) : (
              <div className="vd-related">
                {related.map((item) => (
                  <Link key={item.href} href={item.href} className="fn-row fn-row--compact">
                    {item.thumbnailUrl ? (
                      <Image className="fn-row__thumb" src={item.thumbnailUrl} alt="" />
                    ) : (
                      <span className="fn-row__thumb" aria-hidden="true" />
                    )}
                    <span className="fn-row__body">
                      <span className="fn-row__title">{item.title}</span>
                      {item.creatorName ? <span className="fn-row__meta">{item.creatorName}</span> : null}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Static member table (mock `vd-mtable`); the sortable / card view is the Island. */
function MemberTable({ members }: { members: readonly VideoDetailMember[] }): React.ReactElement {
  return (
    <section aria-labelledby="vd-members" className="vd-members">
      <div className="sec-head">
        <h2 id="vd-members" className="t-h3">
          参加メンバー <span className="muted t-num">{members.length}</span>
        </h2>
      </div>
      <TableScroll ariaLabel="参加メンバー" className="t-scroll">
        <table className="vd-mtable">
          <thead>
            <tr className="t-label muted vd-mhead">
              <th scope="col">活動名</th>
              <th scope="col">役割</th>
              <th scope="col">チャプター</th>
              <th scope="col">コメント</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="vd-mrow">
                <td>
                  <span className="row vd-member">
                    <Avatar src={member.iconUrl} size={28} />
                    <span className="stack">
                      {member.profileHref ? <Link href={member.profileHref}>{member.name}</Link> : <span>{member.name}</span>}
                      {member.xUserId ? (
                        <a
                          href={`https://x.com/${encodeURIComponent(member.xUserId)}`}
                          {...EXTERNAL}
                          className="t-sm muted"
                          aria-label={`X (@${member.xUserId}) を開く`}
                        >
                          @{member.xUserId}
                        </a>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td>{member.role || "—"}</td>
                <td className="t-num vd-mchapter">
                  {member.chapterTimes && member.chapterTimes.length > 0 ? member.chapterTimes.join(", ") : "—"}
                </td>
                <td className="muted">{member.comment || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}
