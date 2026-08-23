"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StaticEventReleaseVideo } from "@/lib/publicData/staticEventReleaseCore";
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
  if (timestamp == null || !Number.isFinite(timestamp)) return "unscheduled";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatDateLabel(key: string): string {
  if (key === "unscheduled") return "日時未定";
  const [year, month, day] = key.split("-");
  return `${year}/${month}/${day}`;
}

function formatDateTime(timestamp: number | null): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

function creatorKey(video: StaticEventReleaseVideo): string {
  return video.creator_x_user_id?.trim().toLowerCase() || video.creator_display_name;
}

function VideoCard({ video, compact = false }: { video: StaticEventReleaseVideo; compact?: boolean }) {
  const detailId = video.youtube_video_id?.trim() || video.id;
  const scheduled = formatDateTime(video.scheduled_time);
  return (
    <article className={`${styles.card} ${compact ? styles.compactCard : ""}`}>
      <div className={styles.cardHead}>
        <div className={styles.titleBlock}>
          <div className={styles.creatorRow}>
            <UserAvatar iconUrl={video.creator_icon_url} label={video.creator_display_name} size={36} useIconFallback />
            <div>
              <p className={styles.creator}>{video.creator_display_name}</p>
              {video.creator_x_user_id ? (
                <a className={styles.creatorLink} href={`https://x.com/${encodeURIComponent(video.creator_x_user_id)}`} target="_blank" rel="noreferrer">
                  <Icon name="x" size={12} aria-hidden /> @{video.creator_x_user_id}
                </a>
              ) : null}
            </div>
          </div>
          <h2>{video.title}</h2>
        </div>
        <div className={styles.cardActions}>
          <Link className="fn-btn fn-btn-ghost fn-btn-sm" href={`/${encodeURIComponent(detailId)}`}>作品詳細へ</Link>
          {video.youtube_video_id ? (
            <a className="fn-btn fn-btn-primary fn-btn-sm" href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.youtube_video_id)}`} target="_blank" rel="noreferrer">YouTube</a>
          ) : null}
        </div>
      </div>
      {scheduled ? <p className={styles.meta}>{scheduled}</p> : null}
      {video.intro_comment ? <p className={styles.comment}>{video.intro_comment}</p> : null}
      {video.members.length > 0 ? (
        <ul className={styles.members} aria-label="公開メンバー">
          {video.members.map((member) => (
            <li key={`${video.id}:${member.order_index}:${member.name}`}>
              <span>{member.name}</span>
              {member.x_user_id ? <a href={`https://x.com/${encodeURIComponent(member.x_user_id)}`} target="_blank" rel="noreferrer">@{member.x_user_id}</a> : null}
              {member.role ? <small>{member.role}</small> : null}
              {member.comment ? <small>{member.comment}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default function ReleaseView({ videos }: { videos: StaticEventReleaseVideo[] }) {
  const [mode, setMode] = useState<ViewMode>(resolveInitialMode);
  useEffect(() => {
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
  const groupedByCreator = useMemo(() => {
    const groups = new Map<string, StaticEventReleaseVideo[]>();
    for (const video of videos) {
      const key = creatorKey(video);
      groups.set(key, [...(groups.get(key) ?? []), video]);
    }
    return [...groups.values()];
  }, [videos]);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    url.hash = next;
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <nav className={styles.viewControls} aria-label="作品表示モード">
        {(["list", "grid", "creator"] as const).map((value) => (
          <button className={`${styles.modeButton} ${mode === value ? styles.modeButtonActive : ""}`} key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}>
            {value === "list" ? "リスト" : value === "grid" ? "グリッド" : "クリエイター"}
          </button>
        ))}
      </nav>
      {mode === "list" ? (
        <div className={styles.dateGroups}>
          {groupedByDate.map(([key, group]) => (
            <section className={styles.dateGroup} key={key}>
              <h2 className={styles.groupTitle}>{formatDateLabel(key)}</h2>
              <ol className={styles.list}>{group.map((video) => <li key={video.id}><VideoCard video={video} /></li>)}</ol>
            </section>
          ))}
        </div>
      ) : null}
      {mode === "grid" ? <div className={styles.grid}>{videos.map((video) => <VideoCard key={video.id} video={video} />)}</div> : null}
      {mode === "creator" ? (
        <div className={styles.creatorGroups}>
          {groupedByCreator.map((group) => (
            <section className={styles.creatorGroup} key={creatorKey(group[0])}>
              <h2 className={styles.groupTitle}>{group[0].creator_display_name}</h2>
              <div className={styles.creatorGrid}>{group.map((video) => <VideoCard key={video.id} video={video} compact />)}</div>
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
