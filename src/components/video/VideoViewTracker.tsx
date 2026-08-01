"use client";

import * as React from "react";
import { sendGAEvent } from "@next/third-parties/google";
import {
  createVideoViewTrackerState,
  markSent,
  onPlayerTimeTick,
  VIEW_THRESHOLD_SECONDS,
  type ViewTrackerStorage,
} from "@/lib/analytics/videoViewTrackerCore";
import { subscribePlayerTime } from "./playerBridge";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function createBrowserStorage(): ViewTrackerStorage {
  return {
    getItem(key: string) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // ignore
      }
    },
  };
}

export interface VideoViewTrackerProps {
  videoId: string;
  youtubeVideoId: string;
  primaryEventId: string | null;
}

export function VideoViewTracker({
  videoId,
  youtubeVideoId,
  primaryEventId,
}: VideoViewTrackerProps): null {
  const stateRef = React.useRef(createVideoViewTrackerState(videoId));
  const visibilityRef = React.useRef<DocumentVisibilityState>("visible");

  React.useEffect(() => {
    stateRef.current = createVideoViewTrackerState(videoId);
  }, [videoId]);

  React.useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;

    visibilityRef.current = document.visibilityState;

    const onVisibilityChange = () => {
      visibilityRef.current = document.visibilityState;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const storage = createBrowserStorage();

    const unsubscribe = subscribePlayerTime((seconds) => {
      const nowMs = Date.now();
      const result = onPlayerTimeTick(stateRef.current, {
        seconds,
        nowMs,
        visibilityState: visibilityRef.current,
        videoId,
        storage,
      });
      stateRef.current = result.state;

      if (!result.shouldSend) return;

      try {
        sendGAEvent("event", "flamenode_video_view", {
          video_id: videoId,
          youtube_video_id: youtubeVideoId,
          primary_event_id: primaryEventId ?? "none",
          watch_threshold_seconds: VIEW_THRESHOLD_SECONDS,
        });
      } catch {
        // 送信失敗で throw しない
      }
      stateRef.current = markSent(stateRef.current, nowMs, storage);
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, [videoId, youtubeVideoId, primaryEventId]);

  return null;
}
