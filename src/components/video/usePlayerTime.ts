"use client";

import * as React from "react";
import { subscribePlayerTime } from "./playerBridge";

export interface PlayerTimeSnapshot {
  currentTime: number;
  received: boolean;
}

export function usePlayerTimeSnapshot(): PlayerTimeSnapshot {
  const [snapshot, setSnapshot] = React.useState<PlayerTimeSnapshot>({
    currentTime: 0,
    received: false,
  });

  React.useEffect(() => {
    return subscribePlayerTime((currentTime) => {
      setSnapshot({
        currentTime,
        received: true,
      });
    });
  }, []);

  return snapshot;
}

export function usePlayerTime(): number {
  return usePlayerTimeSnapshot().currentTime;
}
