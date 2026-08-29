"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StaticEventReleaseVideo } from "@/lib/publicData/staticEventReleaseCore";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { Icon } from "@/components/ui/Icon";
import { UserAvatar } from "@/components/user/UserAvatar";
import styles from "./page.module.css";

type ViewMode = "list" | "grid" | "creator";

function resolveInitialMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  const hash = window.location.hash.slice(1).toLowerCase();
  return hash === "grid" || hash === "creator" ? hash : "list";
}

function formatDateKey(timestamp: number | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "日時未定";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}

function formatTime(timestamp: number | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "--:--";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp * 1000));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function detailHref(video: StaticEventReleaseVideo): string {
  const detailId = video.youtube_video_id?.trim() || video.id;
  return `/${encodeURIComponent(detailId)}`;
}

function type1Label(video: StaticEventReleaseVideo): "複数人" | "個人" {
  return video.collaboration_type === "collab" ? "複数人" : "個人";
}

function typeClassName(label: "複数人" | "個人"): string {
  return label === "複数人" ? styles.typeGroup : styles.typeIndividual;
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <nav className={styles.viewToggle} aria-label="作品表示モード">
      <button
        type="button"
        className={`${styles.toggleButton} ${mode === "list" ? styles.active : ""}`}
        aria-label="リスト表示"
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
      >
        <Icon name="menu" size={24} aria-hidden />
      </button>
      <button
        type="button"
        className={`${styles.toggleButton} ${mode === "grid" ? styles.active : ""}`}
        aria-label="カード表示"
        aria-pressed={mode === "grid"}
        onClick={() => onChange("grid")}
      >
        <Icon name="grid" size={24} aria-hidden />
      </button>
      <button
        type="button"
        className={`${styles.toggleButton} ${mode === "creator" ? styles.active : ""}`}
        aria-label="作者別表示"
        aria-pressed={mode === "creator"}
        onClick={() => onChange("creator")}
      >
        <Icon name="user" size={24} aria-hidden />
      </button>
    </nav>
  );
}

function ListScrollBand({ video }: { video: StaticEventReleaseVideo }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const cloneRef = useRef<HTMLDivElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const hasComment = Boolean(video.intro_comment?.trim());
  const members = video.members ?? [];
  const hasMembers = (video.members?.length ?? 0) > 0;
  const enabled = hasComment || hasMembers;

  useEffect(() => {
    if (!enabled) return;
    animationRef.current?.cancel();
    animationRef.current = null;
    cloneRef.current?.remove();
    cloneRef.current = null;

    const container = scrollContainerRef.current;
    const content = scrollContentRef.current;
    if (!container || !content) return;

    const containerWidth = container.offsetWidth;
    const contentWidth = content.offsetWidth;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const needsScroll = contentWidth > containerWidth && !reducedMotion;
    setShouldScroll(needsScroll);

    const timer = window.setTimeout(() => {
      if (!needsScroll || !scrollContentRef.current) return;
      const clone = scrollContentRef.current.cloneNode(true) as HTMLDivElement;
      clone.setAttribute("aria-hidden", "true");
      scrollContentRef.current.appendChild(clone);
      cloneRef.current = clone;
      const scrollTime = (contentWidth / 50) * 1000;
      animationRef.current = scrollContentRef.current.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(-${contentWidth}px)` }],
        { duration: scrollTime, iterations: Infinity, easing: "linear" },
      );
    }, 3000);

    return () => {
      window.clearTimeout(timer);
      animationRef.current?.cancel();
      animationRef.current = null;
      cloneRef.current?.remove();
      cloneRef.current = null;
    };
  }, [enabled, video.intro_comment, video.members, video.id]);

  if (!enabled) return null;

  return (
    <div className={styles.listContent2} ref={scrollContainerRef}>
      <div className={styles.scrollContent} ref={scrollContentRef}>
        {hasComment ? <span className={styles.listComment}>{video.intro_comment}</span> : null}
        {hasMembers ? (
          <span className={styles.members}>
            メンバー:{" "}
            {members.map((member, index) => (
              <span key={`${video.id}:${member.order_index}:${member.name}`}>
                {member.x_user_id ? (
                  <a
                    href={`https://x.com/${encodeURIComponent(member.x_user_id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {member.name}
                  </a>
                ) : (
                  member.name
                )}
                {member.role ? ` (${member.role})` : ""}
                {member.comment ? ` — ${member.comment}` : ""}
                {index < members.length - 1 ? " / " : ""}
              </span>
            ))}
          </span>
        ) : null}
        {shouldScroll ? <span className={styles.scrollSpacer} aria-hidden /> : null}
      </div>
    </div>
  );
}

function ListRow({ video }: { video: StaticEventReleaseVideo }) {
  const type1 = type1Label(video);
  const part = video.part?.trim() ?? "";
  const youtubeId = video.youtube_video_id?.trim() ?? "";

  return (
    <div className={styles.listItem}>
      <div className={styles.listContent}>
        <span className={styles.date}>{formatTime(video.scheduled_time)}</span>
        <div className={`${styles.type} ${typeClassName(type1)}`}>
          <span>{type1}</span>
          {part ? <span>{part}</span> : null}
        </div>
        <UserAvatar
          className={styles.icon}
          iconUrl={video.creator_icon_url}
          label={video.creator_display_name}
          size={40}
          useIconFallback
        />
        <p className={styles.listCreator}>{video.creator_display_name}</p>
        <p className={styles.listTitle}>{video.title}</p>
        <div className={styles.listActions}>
          {youtubeId ? (
            <a
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`}
              target="_blank"
              rel="noreferrer"
            >
              視聴
            </a>
          ) : null}
          <Link href={detailHref(video)}>詳細</Link>
        </div>
      </div>
      <ListScrollBand video={video} />
    </div>
  );
}

function GridTile({ video, dateLabel }: { video: StaticEventReleaseVideo; dateLabel: string }) {
  const part = video.part?.trim() ?? "";
  const youtubeId = video.youtube_video_id?.trim() ?? "";
  const thumb = youtubeId ? youtubeThumbUrl(youtubeId, "maxresdefault") : "";

  return (
    <div
      className={`${styles.releases1} ${thumb ? "" : styles.releases1Placeholder}`}
      style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
    >
      <div className={styles.releases2}>
        <div className={styles.r0}>{dateLabel}</div>
        <div className={styles.r1}>{formatTime(video.scheduled_time)}</div>
        {part ? <div className={styles.r2}>{part}</div> : <div className={styles.r2} />}
        <div className={styles.r3}>
          <UserAvatar
            className={styles.r31}
            iconUrl={video.creator_icon_url}
            label={video.creator_display_name}
            size={60}
            useIconFallback
          />
        </div>
        <div className={styles.r4}>{video.creator_display_name}</div>
        <div className={styles.r5}>{video.title}</div>
        {video.intro_comment ? <div className={styles.r6}>{video.intro_comment}</div> : null}
        <div className={styles.r7}>
          {youtubeId ? (
            <div className={styles.r71}>
              <a
                href={`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTubeで視聴する
              </a>
            </div>
          ) : null}
          <div className={styles.r72}>
            <Link href={detailHref(video)}>詳細を見る</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatorView({ videos }: { videos: StaticEventReleaseVideo[] }) {
  const router = useRouter();
  const individuals = useMemo(
    () => videos.filter((video) => video.collaboration_type !== "collab"),
    [videos],
  );
  const groups = useMemo(
    () => videos.filter((video) => video.collaboration_type === "collab"),
    [videos],
  );

  const openDetail = useCallback(
    (video: StaticEventReleaseVideo) => {
      router.push(detailHref(video));
    },
    [router],
  );

  const handleKeyOpen = useCallback(
    (event: KeyboardEvent, video: StaticEventReleaseVideo) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(video);
      }
    },
    [openDetail],
  );

  return (
    <div className={styles.membersView}>
      {individuals.length > 0 ? (
        <section className={styles.membersSection}>
          <h3>個人参加</h3>
          <div className={styles.membersList}>
            {individuals.map((video) => {
              const xId = video.creator_x_user_id?.trim() ?? "";
              return (
                <div
                  className={styles.memberCard}
                  key={video.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openDetail(video)}
                  onKeyDown={(event) => handleKeyOpen(event, video)}
                >
                  <div className={styles.membertop}>
                    <UserAvatar
                      className={styles.memberIcon}
                      iconUrl={video.creator_icon_url}
                      label={video.creator_display_name}
                      size={96}
                      useIconFallback
                    />
                  </div>
                  <div className={styles.memberInfo}>
                    <span className={styles.memberName}>{video.creator_display_name}</span>
                    {xId ? (
                      <span className={styles.memberLinks}>
                        <a
                          className={styles.socialLink}
                          href={`https://x.com/${encodeURIComponent(xId)}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Icon name="x" size={18} aria-hidden />
                        </a>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {groups.length > 0 ? (
        <section className={styles.membersSection}>
          <h3>グループ参加</h3>
          <div className={`${styles.membersList} ${styles.groupList}`}>
            {groups.map((video) => {
              const xId = video.creator_x_user_id?.trim() ?? "";
              return (
                <div
                  className={styles.groupCard}
                  key={video.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openDetail(video)}
                  onKeyDown={(event) => handleKeyOpen(event, video)}
                >
                  <UserAvatar
                    className={styles.groupIcon}
                    iconUrl={video.creator_icon_url}
                    label={video.creator_display_name}
                    size={48}
                    useIconFallback
                  />
                  <div className={styles.groupInfo}>
                    <div className={styles.groupName}>
                      {video.creator_display_name}
                      {xId ? (
                        <a
                          className={styles.groupXLink}
                          href={`https://x.com/${encodeURIComponent(xId)}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Icon name="x" size={16} aria-hidden />
                        </a>
                      ) : null}
                    </div>
                    {(video.members?.length ?? 0) > 0 ? (
                      <div className={styles.groupMembers}>
                        {(video.members ?? []).map((member) => (
                          <span
                            className={styles.memberItem}
                            key={`${video.id}:${member.order_index}:${member.name}`}
                          >
                            {member.x_user_id ? (
                              <a
                                href={`https://x.com/${encodeURIComponent(member.x_user_id)}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {member.name}
                              </a>
                            ) : (
                              member.name
                            )}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type ReleaseViewProps = {
  videos: StaticEventReleaseVideo[];
  truncated: boolean;
};

export default function ReleaseView({ videos, truncated }: ReleaseViewProps) {
  const [mode, setMode] = useState<ViewMode>("list");

  useEffect(() => {
    setMode(resolveInitialMode());
    const onHashChange = () => setMode(resolveInitialMode());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, StaticEventReleaseVideo[]>();
    for (const video of videos) {
      const key = formatDateKey(video.scheduled_time);
      groups.set(key, [...(groups.get(key) ?? []), video]);
    }
    return [...groups.entries()];
  }, [videos]);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    url.hash = next;
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <ViewToggle mode={mode} onChange={changeMode} />
      {truncated ? <p className={styles.truncatedNote}>先頭500作品を表示</p> : null}
      {videos.length === 0 ? (
        <div className={styles.releaseState}>公開中の作品はありません。</div>
      ) : mode === "creator" ? (
        <CreatorView videos={videos} />
      ) : mode === "grid" ? (
        <div className={styles.table}>
          {groupedByDate.map(([date, group]) => (
            <div className={styles.dateGroup} key={date}>
              <div className={`${styles.dateHeader} ${styles.dateHeaderTile}`}>{date}</div>
              {group.map((video) => (
                <GridTile key={video.id} video={video} dateLabel={date} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={`${styles.table} ${styles.listView}`}>
          {groupedByDate.map(([date, group]) => (
            <div className={styles.dateGroup} key={date}>
              <div className={`${styles.dateHeader} ${styles.dateHeaderList}`}>{date}</div>
              {group.map((video) => (
                <ListRow key={video.id} video={video} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
