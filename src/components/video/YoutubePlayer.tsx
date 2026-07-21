"use client";

import * as React from "react";
import styles from "./YoutubePlayer.module.css";
import { youtubeEmbedUrl, youtubeThumbUrl } from "@/lib/youtube/id";
import { seekYoutubeIframe } from "./playerBridge";

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
  const [embedOrigin, setEmbedOrigin] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEmbedOrigin(window.location.origin);
  }, []);

  React.useEffect(() => {
    if (!embedOrigin) return;
    const onSeek = (event: Event) => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const time =
        (event as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      seekYoutubeIframe(iframe, time);
    };
    window.addEventListener("flamenode:seek", onSeek as EventListener);
    return () =>
      window.removeEventListener("flamenode:seek", onSeek as EventListener);
  }, [embedOrigin]);

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
        key={youtubeId}
        className={styles.iframe}
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
