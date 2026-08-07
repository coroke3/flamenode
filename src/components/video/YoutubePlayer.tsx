"use client";

import * as React from "react";
import styles from "./YoutubePlayer.module.css";
import { youtubeEmbedUrl, youtubeThumbUrl } from "@/lib/youtube/id";
import {
  isYoutubePlayerMessageOrigin,
  parseYoutubePlayerMessage,
  publishPlayerEnded,
  publishPlayerTime,
  requestYoutubeCurrentTime,
  seekYoutubeIframe,
  startYoutubePlayerListening,
  YOUTUBE_PLAYER_IFRAME_ID,
  YOUTUBE_PLAYER_STATE_ENDED,
} from "./playerBridge";

interface YoutubePlayerProps {
  youtubeId: string;
  title: string;
}

/**
 * YouTube 公式 iframe 埋め込み。
 * チャプターへのシークは `playerBridge.seekToTime` 経由で postMessage seekTo する。
 */
export function YoutubePlayer({
  youtubeId,
  title,
}: YoutubePlayerProps): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const readyRef = React.useRef(false);
  const pendingSeekRef = React.useRef<number | null>(null);
  const endedDispatchedRef = React.useRef(false);
  const [embedOrigin] = React.useState<string | null>(() =>
    typeof window !== "undefined" ? window.location.origin : null,
  );

  React.useEffect(() => {
    readyRef.current = false;
    pendingSeekRef.current = null;
    endedDispatchedRef.current = false;
  }, [embedOrigin, youtubeId]);

  React.useEffect(() => {
    if (!embedOrigin) return;
    const onSeek = (event: Event) => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const time =
        (event as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      if (readyRef.current) {
        seekYoutubeIframe(iframe, time);
      } else {
        pendingSeekRef.current = time;
      }
    };
    window.addEventListener("flamenode:seek", onSeek as EventListener);
    return () =>
      window.removeEventListener("flamenode:seek", onSeek as EventListener);
  }, [embedOrigin]);

  React.useEffect(() => {
    if (!embedOrigin) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    let pollId: number | undefined;

    const flushPendingSeek = () => {
      if (pendingSeekRef.current === null) return;
      seekYoutubeIframe(iframe, pendingSeekRef.current);
      pendingSeekRef.current = null;
    };

    const poll = () => {
      if (document.visibilityState !== "visible") return;
      if (!readyRef.current) return;
      requestYoutubeCurrentTime(iframe);
    };

    const maybePublishEnded = () => {
      if (endedDispatchedRef.current) return;
      endedDispatchedRef.current = true;
      publishPlayerEnded({ youtubeId });
    };

    const onMessage = (event: MessageEvent) => {
      if (!isYoutubePlayerMessageOrigin(event.origin)) return;
      if (event.source !== iframe.contentWindow) return;

      const parsed = parseYoutubePlayerMessage(event.data);
      if (!parsed) return;

      if (parsed.kind === "ready") {
        readyRef.current = true;
        endedDispatchedRef.current = false;
        startYoutubePlayerListening(iframe);
        requestYoutubeCurrentTime(iframe);
        flushPendingSeek();
        if (pollId === undefined) {
          pollId = window.setInterval(poll, 500);
        }
        return;
      }

      if (parsed.kind === "time") {
        publishPlayerTime(parsed.currentTime);
        return;
      }

      if (parsed.kind === "ended") {
        maybePublishEnded();
        return;
      }

      if (typeof parsed.currentTime === "number") {
        publishPlayerTime(parsed.currentTime);
      }

      if (parsed.playerState === YOUTUBE_PLAYER_STATE_ENDED) {
        maybePublishEnded();
      } else {
        endedDispatchedRef.current = false;
      }
    };

    const onLoad = () => {
      startYoutubePlayerListening(iframe);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!readyRef.current) return;
      startYoutubePlayerListening(iframe);
      requestYoutubeCurrentTime(iframe);
    };

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pollId !== undefined) {
        window.clearInterval(pollId);
      }
    };
  }, [embedOrigin, youtubeId]);

  const thumbUrl = youtubeThumbUrl(youtubeId, "hqdefault");

  if (!embedOrigin) {
    return (
      <div
        className={styles.wrap}
        aria-busy="true"
        aria-label={`${title} を読み込み中`}
      >
        {thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className={styles.placeholder}
            src={thumbUrl}
            alt=""
            aria-hidden
          />
        ) : (
          <div className={styles.placeholder} aria-hidden />
        )}
      </div>
    );
  }

  const src = youtubeEmbedUrl(youtubeId, {
    enableJsApi: true,
    origin: embedOrigin,
  });

  return (
    <div className={styles.wrap}>
      <iframe
        ref={iframeRef}
        id={YOUTUBE_PLAYER_IFRAME_ID}
        key={youtubeId}
        className={styles.iframe}
        src={src}
        title={title}
        loading="eager"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
