"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./PlaylistRail.module.css";
import { Icon } from "@/components/ui/Icon";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { cn } from "@/lib/utils/cn";
import { uniqueBy } from "@/lib/utils/unique";

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
  presentation?: "rail" | "responsive";
}

const AUTO_NEXT_KEY = "fn-playlist-autonext";
const orderStorageKey = (playlistId: string) => `fn-playlist-order:${playlistId}`;

function applySavedOrder(
  items: PlaylistEntry[],
  savedOrder: string[],
): PlaylistEntry[] {
  const uniqueItems = uniqueBy(items, (item) => item.id);
  if (savedOrder.length === 0) return uniqueItems;
  const byId = new Map(uniqueItems.map((item) => [item.id, item]));
  const ordered = savedOrder
    .map((id) => byId.get(id))
    .filter((item): item is PlaylistEntry => Boolean(item));
  const remaining = uniqueItems.filter((item) => !savedOrder.includes(item.id));
  return [...ordered, ...remaining];
}

export function PlaylistRail({
  label = "再生リスト",
  items,
  currentId,
  playlistId,
  presentation = "rail",
}: PlaylistRailProps): React.ReactElement | null {
  const router = useRouter();
  const [autoNext, setAutoNext] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [order, setOrder] = React.useState<string[]>([]);
  const navigationInFlightRef = React.useRef(false);

  const orderKey = playlistId ? orderStorageKey(playlistId) : null;

  React.useEffect(() => {
    try {
      setAutoNext(localStorage.getItem(AUTO_NEXT_KEY) === "1");
      if (orderKey) {
        const raw = localStorage.getItem(orderKey);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        if (Array.isArray(parsed)) {
          setOrder(parsed.filter((id): id is string => typeof id === "string"));
        }
      }
    } catch {
      /* noop */
    }
    setHydrated(true);
  }, [orderKey]);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(AUTO_NEXT_KEY, autoNext ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [autoNext, hydrated]);

  React.useEffect(() => {
    if (!hydrated || !orderKey) return;
    try {
      localStorage.setItem(orderKey, JSON.stringify(order));
    } catch {
      /* noop */
    }
  }, [hydrated, order, orderKey]);

  const orderedItems = React.useMemo(
    () => applySavedOrder(items, order),
    [items, order],
  );

  const currentIndex = React.useMemo(
    () =>
      orderedItems.findIndex(
        (v) => v.id === currentId || v.youtube_video_id === currentId,
      ),
    [orderedItems, currentId],
  );

  const nextItem = currentIndex >= 0 ? orderedItems[currentIndex + 1] : null;
  const prevItem = currentIndex > 0 ? orderedItems[currentIndex - 1] : null;

  const makeHref = React.useCallback(
    (item: PlaylistEntry) => {
      const target = item.youtube_video_id ?? item.id;
      return playlistId
        ? `/${target}?playlist=${encodeURIComponent(playlistId)}`
        : `/${target}`;
    },
    [playlistId],
  );

  const moveItem = React.useCallback(
    (itemId: string, direction: -1 | 1) => {
      const currentOrder = orderedItems.map((item) => item.id);
      const from = currentOrder.indexOf(itemId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= currentOrder.length) return;
      const next = [...currentOrder];
      [next[from], next[to]] = [next[to], next[from]];
      setOrder(next);
    },
    [orderedItems],
  );

  const resetOrder = React.useCallback(() => {
    setOrder([]);
  }, []);

  React.useEffect(() => {
    navigationInFlightRef.current = false;
  }, [currentId]);

  React.useEffect(() => {
    if (!autoNext || !nextItem) return;
    const currentEntry =
      currentIndex >= 0 ? orderedItems[currentIndex] : null;
    const handler = (event: Event) => {
      if (navigationInFlightRef.current) return;
      const detailYoutubeId = (
        event as CustomEvent<{ youtubeId?: string }>
      ).detail?.youtubeId;
      if (typeof detailYoutubeId === "string" && detailYoutubeId.trim() !== "") {
        const matchesCurrent =
          currentEntry?.youtube_video_id === detailYoutubeId ||
          currentEntry?.id === detailYoutubeId ||
          currentId === detailYoutubeId;
        if (!matchesCurrent) return;
      }
      navigationInFlightRef.current = true;
      router.push(makeHref(nextItem));
      window.setTimeout(() => {
        navigationInFlightRef.current = false;
      }, 2500);
    };
    window.addEventListener("flamenode:video-ended", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flamenode:video-ended",
        handler as EventListener,
      );
  }, [
    autoNext,
    currentId,
    currentIndex,
    makeHref,
    nextItem,
    orderedItems,
    router,
  ]);

  if (items.length === 0) return null;

  return (
    <section
      className={styles.root}
      data-presentation={presentation}
      aria-label={label}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PLAYLIST</p>
          <h3 className={styles.title}>{label}</h3>
          <p className={styles.meta}>
            {currentIndex >= 0
              ? `${currentIndex + 1} / ${orderedItems.length}`
              : `${orderedItems.length} 本`}
          </p>
        </div>
        <div className={styles.headerControls}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={resetOrder}
            title="並び順を初期化"
            aria-label="並び順を初期化"
            disabled={order.length === 0}
          >
            <Icon name="refresh" size={13} aria-hidden />
          </button>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => setAutoNext(e.target.checked)}
              aria-label="次の動画を自動再生"
            />
            <span>自動再生</span>
          </label>
        </div>
      </header>

      <div className={styles.actions}>
        {prevItem ? (
          <Link
            href={makeHref(prevItem)}
            className="fn-btn fn-btn-ghost fn-btn-sm"
            prefetch={false}
          >
            <Icon name="prev" size={12} aria-hidden />
            前へ
          </Link>
        ) : (
          <span className={styles.actionDisabled}>
            <Icon name="prev" size={12} aria-hidden />
            前へ
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
        {orderedItems.map((v, i) => {
          const active = i === currentIndex;
          return (
            <li key={`${v.id}-${i}`} className={styles.row}>
              <div className={styles.reorderControls}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => moveItem(v.id, -1)}
                  disabled={i === 0}
                  title="上へ"
                  aria-label={`${v.title}を上へ移動`}
                >
                  <Icon name="chevron-up" size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => moveItem(v.id, 1)}
                  disabled={i === orderedItems.length - 1}
                  title="下へ"
                  aria-label={`${v.title}を下へ移動`}
                >
                  <Icon name="chevron-down" size={12} aria-hidden />
                </button>
              </div>
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
