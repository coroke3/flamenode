"use client";

import * as React from "react";
import styles from "./YoutubePlayer.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  youtubeEmbedUrl,
  youtubeWatchUrl,
  youtubeThumbUrl,
} from "@/lib/youtube/id";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface ChapterMarker {
  id: string;
  time: number;
  label: string;
  visibility: "public" | "private";
  marker_kind: "comment" | "chapter" | "review" | "system";
  is_owner?: boolean;
}

interface YoutubePlayerProps {
  youtubeId: string;
  title: string;
  duration?: number | null;
  chapters?: ChapterMarker[];
  accentColor?: string | null;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_API_SRC = "https://www.youtube.com/iframe_api";

/**
 * 独自プレイヤー: YouTube iframe を FlameNode の独自コントロール層で包む。
 *  - 再生 / 一時停止 / シーク / 1/30秒コマ送り / 音量 / 全画面 / YouTube で開く
 *  - チャプターマーカーをシークバー上に小さな点として表示
 *  - マウス停止 or 領域外移動でオーバーレイを即座に非表示
 *  - キーボード: Space (再生/停止), 左右 (5秒シーク), `,` `.` (1/30秒コマ送り)
 */
export function YoutubePlayer({
  youtubeId,
  title,
  chapters = [],
  accentColor,
}: YoutubePlayerProps): React.ReactElement {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<any>(null);
  const containerId = React.useId().replace(/:/g, "_");

  const [ready, setReady] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [overlayVisible, setOverlayVisible] = React.useState(true);
  const hideTimer = React.useRef<number | null>(null);

  const accent = accentColor || undefined;

  React.useEffect(() => {
    let disposed = false;

    const init = () => {
      if (disposed || !wrapperRef.current) return;
      const YT = window.YT;
      if (!YT?.Player) return;
      playerRef.current = new YT.Player(containerId, {
        videoId: youtubeId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          enablejsapi: 1,
        },
        events: {
          onReady: () => {
            if (disposed) return;
            setReady(true);
            setDuration(playerRef.current?.getDuration?.() ?? 0);
          },
          onStateChange: (e: any) => {
            const state = e?.data;
            if (state === YT.PlayerState.PLAYING) setPlaying(true);
            else if (
              state === YT.PlayerState.PAUSED ||
              state === YT.PlayerState.ENDED
            )
              setPlaying(false);
            if (state === YT.PlayerState.PLAYING && playerRef.current) {
              setDuration(playerRef.current.getDuration?.() ?? 0);
            }
          },
        },
      });
    };

    if (!window.YT) {
      const existing = document.querySelector(`script[src="${YT_API_SRC}"]`);
      if (!existing) {
        const s = document.createElement("script");
        s.src = YT_API_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        init();
      };
    } else {
      init();
    }

    return () => {
      disposed = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, [youtubeId, containerId]);

  React.useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      try {
        const t = playerRef.current?.getCurrentTime?.();
        if (typeof t === "number") setCurrentTime(t);
      } catch {
        /* noop */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [ready]);

  const showOverlay = React.useCallback(() => {
    setOverlayVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOverlayVisible(false), 2400);
  }, []);
  const hideOverlay = () => setOverlayVisible(false);

  React.useEffect(() => {
    if (!ready) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      const p = playerRef.current;
      if (!p) return;
      switch (ev.key) {
        case " ":
        case "k":
          ev.preventDefault();
          if (playing) p.pauseVideo?.();
          else p.playVideo?.();
          break;
        case "ArrowRight":
          p.seekTo?.(p.getCurrentTime?.() + 5, true);
          break;
        case "ArrowLeft":
          p.seekTo?.(Math.max(0, p.getCurrentTime?.() - 5), true);
          break;
        case ",":
          p.pauseVideo?.();
          p.seekTo?.(Math.max(0, p.getCurrentTime?.() - 1 / 30), true);
          break;
        case ".":
          p.pauseVideo?.();
          p.seekTo?.(p.getCurrentTime?.() + 1 / 30, true);
          break;
        case "f":
          requestFullscreen();
          break;
        case "m":
          toggleMute();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, playing]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo?.();
    else p.playVideo?.();
  };
  const seekTo = (sec: number) => {
    playerRef.current?.seekTo?.(Math.max(0, Math.min(duration, sec)), true);
  };
  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (muted) {
      p.unMute?.();
      setMuted(false);
    } else {
      p.mute?.();
      setMuted(true);
    }
  };
  const requestFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  };
  const handleSeekBar = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    seekTo(ratio * duration);
  };

  const visibleChapters = chapters.filter(
    (c) =>
      c.time <= duration &&
      (c.visibility === "public" || c.is_owner || c.marker_kind === "chapter"),
  );

  const accentStyle = accent
    ? ({
        ["--accent-primary" as never]: accent,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseMove={showOverlay}
      onMouseLeave={hideOverlay}
      onTouchStart={showOverlay}
      style={accentStyle}
    >
      <div id={containerId} className={styles.iframeBox} />

      <button
        type="button"
        aria-label={playing ? "一時停止" : "再生"}
        onClick={togglePlay}
        className={cn(
          styles.centerBtn,
          overlayVisible || !playing ? "" : styles.centerBtnHidden,
        )}
      >
        <Icon name={playing ? "pause" : "play"} size={28} />
      </button>

      <div
        className={cn(styles.topBar, !overlayVisible && styles.hidden)}
      >
        <h2 className={styles.titleText}>{title}</h2>
        <a
          href={youtubeWatchUrl(youtubeId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="YouTube で開く"
          className={styles.iconBtn}
        >
          <Icon name="youtube" size={18} />
        </a>
      </div>

      <div
        className={cn(styles.bottomBar, !overlayVisible && styles.hidden)}
      >
        <div
          className={styles.seekBar}
          onClick={handleSeekBar}
          role="slider"
          aria-label="再生位置"
          aria-valuenow={Math.floor(
            (currentTime / Math.max(duration, 1)) * 100,
          )}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div className={styles.seekTrack} />
          <div
            className={styles.seekProgress}
            style={{
              width: `${(currentTime / Math.max(duration, 1)) * 100}%`,
            }}
          />
          {visibleChapters.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`${formatDuration(c.time)} ${c.label}`}
              title={`${formatDuration(c.time)} ${c.label}`}
              onClick={(e) => {
                e.stopPropagation();
                seekTo(c.time);
              }}
              className={cn(
                styles.chapterDot,
                c.visibility === "private" && styles.chapterDotPrivate,
              )}
              style={{
                left: `${(c.time / Math.max(duration, 1)) * 100}%`,
              }}
            />
          ))}
        </div>

        <div className={styles.controlsRow}>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "一時停止" : "再生"}
            className={styles.iconBtn}
          >
            <Icon name={playing ? "pause" : "play"} size={14} />
          </button>
          <button
            type="button"
            onClick={() => seekTo(currentTime - 1 / 30)}
            aria-label="1コマ戻る"
            title="1/30秒戻る (,)"
            className={styles.iconBtn}
          >
            <Icon name="step-back" size={14} />
          </button>
          <button
            type="button"
            onClick={() => seekTo(currentTime + 1 / 30)}
            aria-label="1コマ進む"
            title="1/30秒進む (.)"
            className={styles.iconBtn}
          >
            <Icon name="step-forward" size={14} />
          </button>
          <span className={styles.timeText}>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <span className={styles.spacer} />
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "ミュート解除" : "ミュート"}
            className={styles.iconBtn}
          >
            <Icon name={muted ? "mute" : "volume"} size={14} />
          </button>
          <button
            type="button"
            onClick={requestFullscreen}
            aria-label="全画面"
            className={styles.iconBtn}
          >
            <Icon name="fullscreen" size={14} />
          </button>
        </div>
      </div>

      {!ready ? (
        <div className={styles.fallbackThumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={youtubeThumbUrl(youtubeId, "maxresdefault")} alt="" />
          <Icon name="play" size={36} />
        </div>
      ) : null}

      <noscript>
        <iframe
          src={youtubeEmbedUrl(youtubeId)}
          title={title}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className={styles.iframeBox}
        />
      </noscript>
    </div>
  );
}
