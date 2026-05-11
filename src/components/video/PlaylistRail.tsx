"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./PlaylistRail.module.css";
import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { cn } from "@/lib/utils/cn";

export interface PlaylistEntry {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
}

interface PlaylistRailProps {
  label?: string;
  items: PlaylistEntry[];
  currentId: string;
  playlistId?: string;
}

const STORAGE_KEY = "fn-playlist-autonext";

export function PlaylistRail({
  label = "再生リスト",
  items,
  currentId,
  playlistId,
}: PlaylistRailProps): React.ReactElement | null {
  const router = useRouter();
  const [autoNext, setAutoNext] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      setAutoNext(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* noop */
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, autoNext ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [autoNext, hydrated]);

  const currentIndex = React.useMemo(
    () =>
      items.findIndex(
        (v) => v.id === currentId || v.youtube_video_id === currentId,
      ),
    [items, currentId],
  );

  const nextItem = currentIndex >= 0 ? items[currentIndex + 1] : null;
  const prevItem = currentIndex > 0 ? items[currentIndex - 1] : null;

  const makeHref = React.useCallback(
    (item: PlaylistEntry) => {
      const target = item.youtube_video_id ?? item.id;
      return playlistId
        ? `/${target}?playlist=${encodeURIComponent(playlistId)}`
        : `/${target}`;
    },
    [playlistId],
  );

  React.useEffect(() => {
    if (!autoNext || !nextItem) return;
    const handler = () => {
      router.push(makeHref(nextItem));
    };
    window.addEventListener("flamenode:video-ended", handler);
    return () => window.removeEventListener("flamenode:video-ended", handler);
  }, [autoNext, makeHref, nextItem, router]);

  if (items.length === 0) return null;

  return (
    <section className={styles.root} aria-label={label}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PLAYLIST</p>
          <h3 className={styles.title}>{label}</h3>
          <p className={styles.meta}>
            {currentIndex >= 0
              ? `${currentIndex + 1} / ${items.length}`
              : `${items.length} 本`}
          </p>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => setAutoNext(e.target.checked)}
            aria-label="次の動画を自動再生"
          />
          <span>自動再生</span>
        </label>
      </header>

      <div className={styles.actions}>
        {prevItem ? (
          <Link
            href={makeHref(prevItem)}
            className="fn-btn fn-btn-ghost fn-btn-sm"
            prefetch={false}
          >
            <Icon name="prev" size={12} aria-hidden />前へ
          </Link>
        ) : (
          <span className={styles.actionDisabled}>
            <Icon name="prev" size={12} aria-hidden />前へ
          </span>
        )}
        {nextItem ? (
          <Link
            href={makeHref(nextItem)}
            className="fn-btn fn-btn-primary fn-btn-sm"
            prefetch={false}
          >
            次へ
            <Icon name="next" size={12} aria-hidden />
          </Link>
        ) : (
          <span className={styles.actionDisabled}>
            次へ
            <Icon name="next" size={12} aria-hidden />
          </span>
        )}
      </div>

      <ol className={styles.list}>
        {items.map((v, i) => {
          const active = i === currentIndex;
          return (
            <li key={v.id}>
              <Link
                href={makeHref(v)}
                className={cn(styles.item, active && styles.itemActive)}
                aria-current={active ? "true" : undefined}
                prefetch={false}
              >
                <span className={styles.itemIndex} aria-hidden>
                  {active ? <Icon name="play" size={11} /> : <span>{i + 1}</span>}
                </span>
                <span className={styles.itemThumb}>
                  {v.youtube_video_id ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={youtubeThumbUrl(v.youtube_video_id, "default")}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.itemThumbFb}>
                      <Icon name="youtube" size={14} aria-hidden />
                    </span>
                  )}
                </span>
                <span className={styles.itemBody}>
                  <span className={styles.itemTitle}>{v.title}</span>
                  <span className={styles.itemAuthor}>{v.display_name}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
