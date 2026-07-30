"use client";

import * as React from "react";
import {
  MOBILE_QUERY,
  SCROLL_THROTTLE_MS,
  applyMobileVideoGeometryCssVars,
  clearMobileVideoGeometryCssVars,
  computeMobileVideoGeometry,
  metricsToCssVars,
  type MobileVideoGeometryCssVars,
} from "./mobileVideoGeometry";

export function useMobileVideoGeometry(
  playerRef: React.RefObject<HTMLElement | null>,
): void {
  React.useLayoutEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const root = document.documentElement;
    const media = window.matchMedia(MOBILE_QUERY);

    let frame = 0;
    let scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollThrottlePending = false;
    let observedHeader: HTMLElement | null = null;
    let lastCssVars: MobileVideoGeometryCssVars | null = null;
    let lastNonKeyboardPlayerSize: {
      playerWidth: number;
      playerHeight: number;
    } | null = null;

    const observer = new ResizeObserver(() => {
      schedule();
    });

    const clearVariables = () => {
      clearMobileVideoGeometryCssVars(root);
      lastCssVars = null;
      lastNonKeyboardPlayerSize = null;
    };

    const resolveHeader = () => {
      const header = document.querySelector<HTMLElement>(".fn-header");

      if (header === observedHeader) {
        return header;
      }

      if (observedHeader) {
        observer.unobserve(observedHeader);
      }

      observedHeader = header;

      if (observedHeader) {
        observer.observe(observedHeader);
      }

      return header;
    };

    const update = () => {
      if (!media.matches) {
        player.dataset.fullscreen = "false";
        clearVariables();
        return;
      }

      const fullscreen = document.fullscreenElement;
      const fullscreenInside = Boolean(
        fullscreen &&
          (fullscreen === player || player.contains(fullscreen)),
      );

      player.dataset.fullscreen = fullscreenInside ? "true" : "false";

      if (fullscreenInside) {
        return;
      }

      const header = resolveHeader();
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;

      const metrics = computeMobileVideoGeometry(
        {
          headerBottom,
          viewportHeight,
          viewportWidth,
          viewportTop,
          viewportLeft,
          windowInnerHeight: window.innerHeight,
        },
        lastNonKeyboardPlayerSize,
      );

      if (metrics.keyboardInset === 0) {
        lastNonKeyboardPlayerSize = {
          playerWidth: metrics.playerWidth,
          playerHeight: metrics.playerHeight,
        };
      }

      const cssVars = metricsToCssVars(metrics);
      applyMobileVideoGeometryCssVars(root, cssVars, lastCssVars);
      lastCssVars = cssVars;
    };

    function schedule(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }

    function scheduleFromScroll(): void {
      if (scrollThrottleTimer !== null) {
        scrollThrottlePending = true;
        return;
      }

      schedule();

      scrollThrottleTimer = setTimeout(() => {
        scrollThrottleTimer = null;
        if (scrollThrottlePending) {
          scrollThrottlePending = false;
          schedule();
        }
      }, SCROLL_THROTTLE_MS);
    }

    resolveHeader();
    schedule();

    const viewport = window.visualViewport;

    media.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scheduleFromScroll, { passive: true });
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("fullscreenchange", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", scheduleFromScroll);

    return () => {
      cancelAnimationFrame(frame);
      if (scrollThrottleTimer !== null) {
        clearTimeout(scrollThrottleTimer);
      }
      observer.disconnect();
      media.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scheduleFromScroll);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", scheduleFromScroll);
      clearVariables();
    };
  }, [playerRef]);
}
