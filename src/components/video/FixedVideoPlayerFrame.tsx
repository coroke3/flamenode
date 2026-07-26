"use client";

import * as React from "react";
import { useMobileVideoGeometry } from "./useMobileVideoGeometry";
import styles from "./FixedVideoPlayerFrame.module.css";

export function FixedVideoPlayerFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const playerRef = React.useRef<HTMLDivElement>(null);

  useMobileVideoGeometry(playerRef);

  return (
    <>
      <div className={styles["fn-mobile-player-spacer"]} aria-hidden />

      <div
        ref={playerRef}
        id="video-player-boundary"
        className={[styles.root, className].filter(Boolean).join(" ")}
        data-video-player-boundary
        data-fullscreen="false"
      >
        {children}
      </div>
    </>
  );
}
