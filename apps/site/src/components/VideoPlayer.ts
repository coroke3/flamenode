import React from "react";
import {
  isYoutubePlayerMessageOrigin,
  parseYoutubePlayerMessage,
  publishPlayerEnded,
  publishPlayerTime,
  requestYoutubeCurrentTime,
  seekYoutubeIframe,
  startYoutubePlayerListening,
  subscribePlayerTime,
  YOUTUBE_PLAYER_IFRAME_ID,
  YOUTUBE_PLAYER_STATE_ENDED,
  YOUTUBE_PLAYER_STATE_PLAYING,
} from "../../../../src/components/video/playerBridge.ts";
import {
  createVideoViewTrackerState,
  markSent,
  onPlayerTimeTick,
  VIEW_THRESHOLD_SECONDS,
  type ViewTrackerStorage,
} from "../../../../src/lib/analytics/videoViewTrackerCore.ts";
import { youtubeEmbedUrl, youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";

/**
 * YouTube player + view tracker Island for `/[id]` (MIG-0507 U03 / U06). The player is CURRENT `YoutubePlayer`
 * (official iframe, seek by postMessage, time/ended events through the CURRENT pure `playerBridge`), the tracker
 * is CURRENT `VideoViewTracker`: one `flamenode_video_view` GA4 event after `VIEW_THRESHOLD_SECONDS` of watched
 * time, at most once per 6 hours per video (localStorage cooldown, CURRENT `videoViewTrackerCore`). The tracker
 * runs only when the build has a GA4 measurement id (`gaEnabled`), as CURRENT. No network call besides YouTube.
 */
const h = React.createElement;

export interface VideoPlayerProps {
  videoId: string;
  youtubeId: string;
  title: string;
  primaryEventId: string | null;
  gaEnabled: boolean;
}

function browserStorage(): ViewTrackerStorage {
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Same call as `@next/third-parties` `sendGAEvent` (gtag pushes its `arguments` object). */
export function sendGAEvent(...args: unknown[]): void {
  const w = window as unknown as { dataLayer?: unknown[] };
  if (!w.dataLayer) return;
  (function gtag(..._a: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  })(...args);
}

function useViewTracker({ videoId, youtubeId, primaryEventId, gaEnabled }: VideoPlayerProps): void {
  const state = React.useRef(createVideoViewTrackerState(videoId));
  const visibility = React.useRef<DocumentVisibilityState>("visible");
  React.useEffect(() => {
    state.current = createVideoViewTrackerState(videoId);
  }, [videoId]);
  React.useEffect(() => {
    if (!gaEnabled) return;
    visibility.current = document.visibilityState;
    const onVisibility = () => {
      visibility.current = document.visibilityState;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const storage = browserStorage();
    const unsubscribe = subscribePlayerTime((seconds) => {
      const nowMs = Date.now();
      const result = onPlayerTimeTick(state.current, { seconds, nowMs, visibilityState: visibility.current, videoId, storage });
      state.current = result.state;
      if (!result.shouldSend) return;
      try {
        sendGAEvent("event", "flamenode_video_view", {
          video_id: videoId,
          youtube_video_id: youtubeId,
          primary_event_id: primaryEventId ?? "none",
          watch_threshold_seconds: VIEW_THRESHOLD_SECONDS,
        });
      } catch {
        /* a failed send never throws */
      }
      state.current = markSent(state.current, nowMs, storage);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [videoId, youtubeId, primaryEventId, gaEnabled]);
}

export function VideoPlayer(props: VideoPlayerProps): React.ReactElement {
  const { youtubeId, title } = props;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const ready = React.useRef(false);
  const pendingSeek = React.useRef<number | null>(null);
  const endedSent = React.useRef(false);
  // The server HTML is the thumbnail; the origin is read after mount so hydration matches it (CURRENT note).
  const [origin, setOrigin] = React.useState<string | null>(null);
  React.useEffect(() => setOrigin(window.location.origin), []);
  useViewTracker(props);

  React.useEffect(() => {
    ready.current = false;
    pendingSeek.current = null;
    endedSent.current = false;
  }, [origin, youtubeId]);

  React.useEffect(() => {
    if (!origin) return;
    const onSeek = (event: Event) => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const time = (event as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      if (ready.current) seekYoutubeIframe(iframe, time);
      else pendingSeek.current = time;
    };
    window.addEventListener("flamenode:seek", onSeek as EventListener);
    return () => window.removeEventListener("flamenode:seek", onSeek as EventListener);
  }, [origin]);

  React.useEffect(() => {
    if (!origin) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let pollId: number | undefined;
    const sendEnded = () => {
      if (endedSent.current) return;
      endedSent.current = true;
      publishPlayerEnded({ youtubeId });
    };
    const onMessage = (event: MessageEvent) => {
      if (!isYoutubePlayerMessageOrigin(event.origin) || event.source !== iframe.contentWindow) return;
      const parsed = parseYoutubePlayerMessage(event.data);
      if (!parsed) return;
      if (parsed.kind === "ready") {
        ready.current = true;
        endedSent.current = false;
        startYoutubePlayerListening(iframe);
        requestYoutubeCurrentTime(iframe);
        if (pendingSeek.current !== null) {
          seekYoutubeIframe(iframe, pendingSeek.current);
          pendingSeek.current = null;
        }
        if (pollId === undefined) {
          pollId = window.setInterval(() => {
            if (document.visibilityState === "visible" && ready.current) requestYoutubeCurrentTime(iframe);
          }, 500);
        }
        return;
      }
      if (parsed.kind === "time") return publishPlayerTime(parsed.currentTime);
      if (parsed.kind === "ended") return sendEnded();
      if (typeof parsed.currentTime === "number") publishPlayerTime(parsed.currentTime);
      if (parsed.playerState === YOUTUBE_PLAYER_STATE_ENDED) sendEnded();
      else if (parsed.playerState === YOUTUBE_PLAYER_STATE_PLAYING) endedSent.current = false; // replay may end again
    };
    const onLoad = () => startYoutubePlayerListening(iframe);
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !ready.current) return;
      startYoutubePlayerListening(iframe);
      requestYoutubeCurrentTime(iframe);
    };
    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisible);
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, [origin, youtubeId]);

  if (!origin) {
    const thumb = youtubeThumbUrl(youtubeId, "hqdefault");
    return h(
      "div",
      { className: "vd-player", "aria-busy": "true", "aria-label": `${title} を読み込み中` },
      thumb ? h("img", { className: "cover", src: thumb, alt: "", "aria-hidden": "true" }) : null,
    );
  }
  return h(
    "div",
    { className: "vd-player" },
    h("iframe", {
      ref: iframeRef,
      id: YOUTUBE_PLAYER_IFRAME_ID,
      key: youtubeId,
      className: "vd-iframe",
      src: youtubeEmbedUrl(youtubeId, { enableJsApi: true, origin }),
      title,
      loading: "eager",
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      allowFullScreen: true,
    }),
  );
}

export default VideoPlayer;
