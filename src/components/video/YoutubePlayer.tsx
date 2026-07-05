"use client";

import * as React from "react";
import styles from "./YoutubePlayer.module.css";
import { youtubeEmbedUrl } from "@/lib/youtube/id";

interface YoutubePlayerProps {
  youtubeId: string;
  title: string;
}

/**
 * YouTube 公式 iframe 埋め込み。
 * チャプターへのシークは `playerBridge.seekToTime` 経由で start パラメータを更新する。
 */
export function YoutubePlayer({
  youtubeId,
  title,
}: YoutubePlayerProps): React.ReactElement {
  const [start, setStart] = React.useState(0);

  React.useEffect(() => {
    const onSeek = (event: Event) => {
      const time =
        (event as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      setStart(Math.max(0, Math.floor(time)));
    };
    window.addEventListener("flamenode:seek", onSeek as EventListener);
    return () =>
      window.removeEventListener("flamenode:seek", onSeek as EventListener);
  }, []);

  const src = youtubeEmbedUrl(youtubeId, { start });

  return (
    <div className={styles.wrap}>
      <iframe
        key={`${youtubeId}-${start}`}
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
