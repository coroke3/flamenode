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
const QUALITY_ORDER = [
  "highres",
  "hd2160",
  "hd1440",
  "hd1080",
  "hd720",
  "large",
  "medium",
  "small",
  "tiny",
];

function pickBestQuality(levels: string[] | undefined): string {
  if (!levels || levels.length === 0) return "hd2160";
  return QUALITY_ORDER.find((q) => levels.includes(q)) ?? levels[0] ?? "hd2160";
}

function qualityLabel(q: string | null): string {
  const labels: Record<string, string> = {
    highres: "MAX",
    hd2160: "4K",
    hd1440: "1440p",
    hd1080: "1080p",
    hd720: "720p",
    large: "480p",
    medium: "360p",
    small: "240p",
    tiny: "144p",
    auto: "AUTO",
  };
  return labels[q ?? ""] ?? "MAX";
}

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
  const [volume, setVolume] = React.useState(100);
  const [quality, setQuality] = React.useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = React.useState(true);
  // 初回再生開始までは fallbackThumb で iframe を完全に覆い、
  // YouTube 側のタイトル / 大きな ▶ などの UI を表に出さない。
  const [hasInitiallyPlayed, setHasInitiallyPlayed] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);

  const requestBestQuality = React.useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      const levels = p.getAvailableQualityLevels?.() as string[] | undefined;
      const best = pickBestQuality(levels);
      p.setPlaybackQualityRange?.(best, best);
      p.setPlaybackQuality?.(best);
      setQuality(best);
    } catch {
      /* YouTube may ignore quality requests for some videos/devices. */
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;

    const init = () => {
      if (disposed || !wrapperRef.current) return;
      const YT = window.YT;
      if (!YT?.Player) return;
      // YouTube 標準 UI を公式パラメータの範囲で最大限抑制し、
      // FlameNode 側の自前操作 UI を表示する。
      // ただし YouTube 埋め込み仕様上、ロゴ・右クリックメニュー・
      // 一部の一時停止時オーバーレイ・エンドカード等は完全消去を保証できない。
      playerRef.current = new YT.Player(containerId, {
        host: "https://www.youtube-nocookie.com",
        videoId: youtubeId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          // modestbranding は現在の YouTube 仕様では非推奨寄りだが、副作用は無いため残す
          modestbranding: 1,
          // cc_load_policy=0 は「字幕を強制表示しない」程度であり、完全無効化ではない
          cc_load_policy: 0,
          // showinfo は新仕様では非推奨だが、古いクライアント向けにタイトル抑止として残す
          showinfo: 0,
          vq: "hd2160",
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (disposed) return;
            const p = playerRef.current;

            // 字幕モジュールの unload を試行する。
            // cc_load_policy=0 だけでは環境や動画設定によって字幕が出る場合があるため、
            // IFrame API 経由でも抑制を試みる。ただし完全な字幕無効化は保証できない。
            try {
              p?.unloadModule?.("captions");
              p?.unloadModule?.("cc");
            } catch {
              /* 環境によっては unloadModule が無効な場合がある — noop */
            }

            setReady(true);
            setDuration(p?.getDuration?.() ?? 0);
            setVolume(p?.getVolume?.() ?? 100);
            setMuted(p?.isMuted?.() ?? false);
            requestBestQuality();
          },
          onStateChange: (e: any) => {
            const state = e?.data;
            if (state === YT.PlayerState.PLAYING) {
              setPlaying(true);
              setHasInitiallyPlayed(true);
              setDuration(playerRef.current?.getDuration?.() ?? 0);
              requestBestQuality();
            } else if (state === YT.PlayerState.PAUSED) {
              setPlaying(false);
            } else if (state === YT.PlayerState.ENDED) {
              setPlaying(false);
              // PlaylistRail などへ再生終了を通知 (自動再生切替時に次動画へ進める)
              try {
                window.dispatchEvent(
                  new CustomEvent("flamenode:video-ended", {
                    detail: { youtubeId },
                  }),
                );
              } catch {
                /* noop */
              }
            }
          },
          onPlaybackQualityChange: (e: any) => {
            if (typeof e?.data === "string") setQuality(e.data);
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
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, [youtubeId, containerId, requestBestQuality]);

  React.useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      try {
        const p = playerRef.current;
        const t = p?.getCurrentTime?.();
        if (typeof t === "number") setCurrentTime(t);
        setMuted(p?.isMuted?.() ?? false);
      } catch {
        /* noop */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [ready]);

  React.useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(requestBestQuality, 3500);
    return () => window.clearInterval(id);
  }, [ready, requestBestQuality]);

  // PlayerBridge: ChapterComposer などからの「現在時刻ください」要求に応える。
  React.useEffect(() => {
    const onRequest = () => {
      try {
        const t = playerRef.current?.getCurrentTime?.() ?? 0;
        window.dispatchEvent(
          new CustomEvent("flamenode:current-time", {
            detail: { time: typeof t === "number" ? t : 0 },
          }),
        );
      } catch {
        window.dispatchEvent(
          new CustomEvent("flamenode:current-time", { detail: { time: 0 } }),
        );
      }
    };
    window.addEventListener("flamenode:request-time", onRequest);
    return () =>
      window.removeEventListener("flamenode:request-time", onRequest);
  }, []);

  const showOverlay = React.useCallback(() => {
    setOverlayVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOverlayVisible(false), 2400);
  }, []);

  const hideOverlay = () => setOverlayVisible(false);

  const setPlayerVolume = React.useCallback((next: number) => {
    const value = Math.max(0, Math.min(100, Math.round(next)));
    const p = playerRef.current;
    setVolume(value);
    if (!p) return;
    p.setVolume?.(value);
    if (value === 0) {
      p.mute?.();
      setMuted(true);
    } else {
      p.unMute?.();
      setMuted(false);
    }
  }, []);

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
        case "ArrowUp":
          ev.preventDefault();
          setPlayerVolume(volume + 5);
          break;
        case "ArrowDown":
          ev.preventDefault();
          setPlayerVolume(volume - 5);
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
  }, [ready, playing, volume, setPlayerVolume]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo?.();
    else p.playVideo?.();
  };

  // クリックシールド: シングルクリックは少し遅延させて、
  // ダブルクリック (フルスクリーン) と二重発火しないようにする。
  const clickShieldTimer = React.useRef<number | null>(null);
  const handleShieldClick = () => {
    if (clickShieldTimer.current) {
      window.clearTimeout(clickShieldTimer.current);
      clickShieldTimer.current = null;
    }
    clickShieldTimer.current = window.setTimeout(() => {
      clickShieldTimer.current = null;
      togglePlay();
    }, 220);
  };
  const handleShieldDoubleClick = () => {
    if (clickShieldTimer.current) {
      window.clearTimeout(clickShieldTimer.current);
      clickShieldTimer.current = null;
    }
    requestFullscreen();
  };

  const seekTo = (sec: number) => {
    playerRef.current?.seekTo?.(Math.max(0, Math.min(duration, sec)), true);
  };

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (muted) {
      const restored = volume === 0 ? 40 : volume;
      p.unMute?.();
      p.setVolume?.(restored);
      setVolume(restored);
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
      (c.visibility === "public" || c.is_owner),
  );

  const accentStyle = accentColor
    ? ({
        ["--accent-primary" as never]: accentColor,
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

      {/* YouTube 側のクリック領域を独自プレイヤーに置き換えるためのシールド。
          バー類が非表示でもクリックは独自プレイヤーが処理する。 */}
      <div
        className={styles.clickShield}
        onClick={handleShieldClick}
        onDoubleClick={handleShieldDoubleClick}
        role="presentation"
        aria-hidden="true"
      />

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

      <div className={cn(styles.topBar, !overlayVisible && styles.hidden)}>
        <h2 className={styles.titleText}>{title}</h2>
        <span className={styles.qualityBadge} title="最高画質を優先">
          {qualityLabel(quality)}
        </span>
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

      <div className={cn(styles.bottomBar, !overlayVisible && styles.hidden)}>
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
            aria-label="1フレーム戻る"
            title="1/30秒戻る (,)"
            className={styles.iconBtn}
          >
            <Icon name="step-back" size={14} />
          </button>
          <button
            type="button"
            onClick={() => seekTo(currentTime + 1 / 30)}
            aria-label="1フレーム進む"
            title="1/30秒進む (.)"
            className={styles.iconBtn}
          >
            <Icon name="step-forward" size={14} />
          </button>
          <span className={styles.timeText}>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <span className={styles.spacer} />
          <div className={styles.volumeGroup}>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "ミュート解除" : "ミュート"}
              className={styles.iconBtn}
            >
              <Icon name={muted || volume === 0 ? "mute" : "volume"} size={14} />
            </button>
            <input
              aria-label="音量"
              className={styles.volumeSlider}
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => setPlayerVolume(Number(e.target.value))}
            />
          </div>
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

      {!ready || !hasInitiallyPlayed ? (
        <button
          type="button"
          className={styles.fallbackThumb}
          aria-label={ready ? "再生" : "読み込み中"}
          onClick={() => {
            if (!ready) return;
            try {
              playerRef.current?.playVideo?.();
            } catch {
              /* noop */
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={youtubeThumbUrl(youtubeId, "maxresdefault")} alt="" />
          <Icon name="play" size={36} />
        </button>
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
