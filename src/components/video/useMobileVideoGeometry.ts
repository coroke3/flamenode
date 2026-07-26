"use client";

import * as React from "react";

const MOBILE_QUERY =
  "(max-width: 900px)";

function px(value: number):
  string {
  return `${
    Math.max(
      0,
      Math.round(value),
    )
  }px`;
}

export function
useMobileVideoGeometry(
  playerRef:
    React.RefObject<
      HTMLElement | null
    >,
): void {
  React.useLayoutEffect(() => {
    const player =
      playerRef.current;

    if (!player) return;

    const root =
      document.documentElement;
    const media =
      window.matchMedia(
        MOBILE_QUERY,
      );

    let frame = 0;
    let observedHeader:
      | HTMLElement
      | null = null;

    const observer =
      new ResizeObserver(() => {
        schedule();
      });

    const clearVariables = () => {
      for (const name of [
        "--fn-header-bottom",
        "--fn-mobile-player-height",
        "--fn-mobile-player-bottom",
        "--fn-visual-viewport-height",
        "--fn-keyboard-inset",
      ]) {
        root.style.removeProperty(
          name,
        );
      }
    };

    const resolveHeader = () => {
      const header =
        document.querySelector<
          HTMLElement
        >(".fn-header");

      if (
        header ===
        observedHeader
      ) {
        return header;
      }

      if (observedHeader) {
        observer.unobserve(
          observedHeader,
        );
      }

      observedHeader = header;

      if (observedHeader) {
        observer.observe(
          observedHeader,
        );
      }

      return header;
    };

    const update = () => {
      if (!media.matches) {
        player.dataset.fullscreen =
          "false";
        clearVariables();
        return;
      }

      const fullscreen =
        document.fullscreenElement;

      const fullscreenInside =
        Boolean(
          fullscreen &&
          (
            fullscreen === player ||
            player.contains(
              fullscreen,
            )
          ),
        );

      player.dataset.fullscreen =
        fullscreenInside
          ? "true"
          : "false";

      if (fullscreenInside) {
        return;
      }

      const header =
        resolveHeader();

      const headerBottom =
        header
          ?.getBoundingClientRect()
          .bottom ?? 0;

      const playerHeight =
        player
          .getBoundingClientRect()
          .height;

      const viewport =
        window.visualViewport;

      const viewportHeight =
        viewport?.height ??
        window.innerHeight;

      const viewportTop =
        viewport?.offsetTop ??
        0;

      const keyboardInset =
        Math.max(
          0,
          window.innerHeight -
            viewportHeight -
            viewportTop,
        );

      root.style.setProperty(
        "--fn-header-bottom",
        px(headerBottom),
      );
      root.style.setProperty(
        "--fn-mobile-player-height",
        px(playerHeight),
      );
      root.style.setProperty(
        "--fn-mobile-player-bottom",
        px(
          headerBottom +
          playerHeight,
        ),
      );
      root.style.setProperty(
        "--fn-visual-viewport-height",
        px(viewportHeight),
      );
      root.style.setProperty(
        "--fn-keyboard-inset",
        px(keyboardInset),
      );
    };

    function schedule(): void {
      cancelAnimationFrame(frame);
      frame =
        requestAnimationFrame(
          update,
        );
    }

    observer.observe(player);
    resolveHeader();
    schedule();

    const viewport =
      window.visualViewport;

    media.addEventListener(
      "change",
      schedule,
    );
    window.addEventListener(
      "resize",
      schedule,
    );
    window.addEventListener(
      "orientationchange",
      schedule,
    );
    document.addEventListener(
      "fullscreenchange",
      schedule,
    );
    viewport?.addEventListener(
      "resize",
      schedule,
    );

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener(
        "change",
        schedule,
      );
      window.removeEventListener(
        "resize",
        schedule,
      );
      window.removeEventListener(
        "orientationchange",
        schedule,
      );
      document.removeEventListener(
        "fullscreenchange",
        schedule,
      );
      viewport?.removeEventListener(
        "resize",
        schedule,
      );
      clearVariables();
    };
  }, [playerRef]);
}
