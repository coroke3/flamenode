"use client";

import * as React from "react";
import { subscribePlayerTime } from "./playerBridge";

export function usePlayerTime(): number {
  const [currentTime, setCurrentTime] = React.useState(0);

  React.useEffect(() => {
    return subscribePlayerTime(setCurrentTime);
  }, []);

  return currentTime;
}
