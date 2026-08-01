"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import styles from "./TopLoopShelf.module.css";

interface TopLoopShelfProps {
  children: React.ReactNode;
  ariaLabel?: string;
  /** トップページ互換用。false の場合は通常の有限スクロールとして扱う。 */
  loop?: boolean;
  autoScroll?: boolean;
  autoScrollSpeed?: number;
  autoScrollDirection?: "left" | "right";
  mobileRows?: 1 | 2;
  pauseAfterInteractionMs?: number;
}

type SourceItem = {
  key: string;
  node: React.ReactNode;
};

const LOOP_GROUPS = [0, 1, 2] as const;
const LEFT_RESET_THRESHOLD = 0.5;
const RIGHT_RESET_THRESHOLD = 1.5;

function toSourceItems(children: React.ReactNode): SourceItem[] {
  return React.Children.toArray(children).map((node, index) => ({
    key:
      React.isValidElement(node) && node.key != null
        ? String(node.key)
        : `top-shelf-${index}`,
    node,
  }));
}

function parsePixelValue(raw: string): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function getCycleWidth(group: HTMLDivElement): number {
  const style = window.getComputedStyle(group);
  return group.getBoundingClientRect().width + parsePixelValue(style.marginRight);
}

function getScrollStep(scroller: HTMLDivElement, group: HTMLDivElement | null): number {
  const first = group?.firstElementChild;
  if (!(first instanceof HTMLElement)) return scroller.clientWidth * 0.85;
  const style = window.getComputedStyle(group);
  const gap = parsePixelValue(style.columnGap || style.gap || "0");
  const stride = first.getBoundingClientRect().width + gap;
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  return stride * (mobile ? 1 : 1.5);
}

export function TopLoopShelf({
  children,
  ariaLabel,
  loop = true,
  autoScroll = true,
  autoScrollSpeed = 18,
  autoScrollDirection = "left",
  mobileRows = 2,
  pauseAfterInteractionMs = 1400,
}: TopLoopShelfProps): React.ReactElement {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const firstGroupRef = React.useRef<HTMLDivElement>(null);
  const cycleWidthRef = React.useRef(0);
  const seededRef = React.useRef(false);
  const frameRef = React.useRef<number | null>(null);
  const normalizeFrameRef = React.useRef<number | null>(null);
  const resumeTimerRef = React.useRef<number | null>(null);
  const pausedRef = React.useRef(false);
  const normalizingRef = React.useRef(false);
  const pointerActiveRef = React.useRef(false);
  const directionRef = React.useRef<1 | -1>(
    autoScrollDirection === "left" ? 1 : -1,
  );
  const pauseReasonsRef = React.useRef({
    hover: false,
    focus: false,
    pointer: false,
    recent: false,
  });

  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [inViewport, setInViewport] = React.useState(true);
  const [documentVisible, setDocumentVisible] = React.useState(true);
  const [canScroll, setCanScroll] = React.useState(false);

  const sourceItems = React.useMemo(() => toSourceItems(children), [children]);
  const sourceSignature = React.useMemo(
    () => sourceItems.map((item) => item.key).join("|"),
    [sourceItems],
  );

  const setPauseReason = React.useCallback((
    reason: keyof typeof pauseReasonsRef.current,
    active: boolean,
  ) => {
    pauseReasonsRef.current[reason] = active;
    pausedRef.current = Object.values(pauseReasonsRef.current).some(Boolean);
  }, []);

  const pauseAfterInteraction = React.useCallback(() => {
    setPauseReason("recent", true);
    if (resumeTimerRef.current != null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setPauseReason("recent", false);
      resumeTimerRef.current = null;
    }, Math.max(0, Math.min(pauseAfterInteractionMs, 10_000)));
  }, [pauseAfterInteractionMs, setPauseReason]);

  const syncScrollableState = React.useCallback((scroller: HTMLDivElement) => {
    setCanScroll(scroller.scrollWidth > scroller.clientWidth + 4);
  }, []);

  const normalizeLoopPosition = React.useCallback(() => {
    const scroller = scrollerRef.current;
    const cycleWidth = cycleWidthRef.current;
    if (!loop || !scroller || !(cycleWidth > 0) || normalizingRef.current) return;

    const current = scroller.scrollLeft;
    let next = current;
    if (current < cycleWidth * LEFT_RESET_THRESHOLD) {
      next = current + cycleWidth;
    } else if (current > cycleWidth * RIGHT_RESET_THRESHOLD) {
      next = current - cycleWidth;
    }

    if (Math.abs(next - current) < 0.5) return;
    normalizingRef.current = true;
    scroller.scrollLeft = next;
    normalizingRef.current = false;
  }, [loop]);

  const scheduleNormalize = React.useCallback(() => {
    if (!loop || normalizeFrameRef.current != null) return;
    normalizeFrameRef.current = window.requestAnimationFrame(() => {
      normalizeFrameRef.current = null;
      normalizeLoopPosition();
    });
  }, [loop, normalizeLoopPosition]);

  const measureAndSeed = React.useCallback(() => {
    const scroller = scrollerRef.current;
    const firstGroup = firstGroupRef.current;
    if (!scroller || !firstGroup) return;

    const previousCycle = cycleWidthRef.current;
    const nextCycle = getCycleWidth(firstGroup);
    if (!(nextCycle > 0)) return;

    cycleWidthRef.current = nextCycle;
    syncScrollableState(scroller);

    if (!loop) return;
    if (!seededRef.current) {
      scroller.scrollLeft = nextCycle;
      seededRef.current = true;
      return;
    }

    if (previousCycle > 0 && Math.abs(previousCycle - nextCycle) > 0.5) {
      const relativeOffset = (scroller.scrollLeft - previousCycle) / previousCycle;
      scroller.scrollLeft = nextCycle + relativeOffset * nextCycle;
      normalizeLoopPosition();
    }
  }, [loop, normalizeLoopPosition, syncScrollableState]);

  React.useLayoutEffect(() => {
    seededRef.current = false;
    cycleWidthRef.current = 0;
    const frame = window.requestAnimationFrame(measureAndSeed);
    const scroller = scrollerRef.current;
    const firstGroup = firstGroupRef.current;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measureAndSeed());
    if (scroller) observer?.observe(scroller);
    if (firstGroup) observer?.observe(firstGroup);
    window.addEventListener("resize", measureAndSeed);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measureAndSeed);
    };
  }, [measureAndSeed, mobileRows, sourceSignature]);

  React.useEffect(() => {
    directionRef.current = autoScrollDirection === "left" ? 1 : -1;
  }, [autoScrollDirection]);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const sync = () => setDocumentVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  React.useEffect(() => {
    if (
      !autoScroll ||
      autoScrollSpeed <= 0 ||
      reducedMotion ||
      !inViewport ||
      !documentVisible
    ) {
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(now - last, 80);
      last = now;
      if (!pausedRef.current && canScroll) {
        const delta = elapsed * (Math.min(autoScrollSpeed, 120) / 1000);
        scroller.scrollLeft += delta * directionRef.current;
        if (loop) {
          normalizeLoopPosition();
        } else {
          const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
          if (scroller.scrollLeft >= maxScroll) directionRef.current = -1;
          if (scroller.scrollLeft <= 0) directionRef.current = 1;
        }
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [
    autoScroll,
    autoScrollSpeed,
    canScroll,
    documentVisible,
    inViewport,
    loop,
    normalizeLoopPosition,
    reducedMotion,
  ]);

  React.useEffect(() => () => {
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
    if (normalizeFrameRef.current != null) {
      window.cancelAnimationFrame(normalizeFrameRef.current);
    }
  }, []);

  const scrollBy = React.useCallback((direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = getScrollStep(scroller, firstGroupRef.current) * direction;
    scroller.scrollBy({
      left: distance,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    pauseAfterInteraction();
  }, [pauseAfterInteraction, reducedMotion]);

  const groups = loop ? LOOP_GROUPS : ([0] as const);

  return (
    <div className={styles.wrapper} data-loop={loop ? "true" : "false"}>
      <div
        ref={scrollerRef}
        className={styles.scroller}
        data-mobile-rows={mobileRows}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={() => {
          const scroller = scrollerRef.current;
          if (scroller) syncScrollableState(scroller);
          scheduleNormalize();
        }}
        onMouseEnter={() => setPauseReason("hover", true)}
        onMouseLeave={() => setPauseReason("hover", false)}
        onFocus={() => setPauseReason("focus", true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPauseReason("focus", false);
          }
        }}
        onPointerDown={() => {
          pointerActiveRef.current = true;
          setPauseReason("pointer", true);
        }}
        onPointerUp={() => {
          pointerActiveRef.current = false;
          setPauseReason("pointer", false);
          pauseAfterInteraction();
        }}
        onPointerCancel={() => {
          pointerActiveRef.current = false;
          setPauseReason("pointer", false);
          pauseAfterInteraction();
        }}
        onPointerLeave={() => {
          if (!pointerActiveRef.current) return;
          pointerActiveRef.current = false;
          setPauseReason("pointer", false);
          pauseAfterInteraction();
        }}
        onWheel={pauseAfterInteraction}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            scrollBy(-1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            scrollBy(1);
          }
        }}
      >
        {groups.map((groupIndex) => (
          <div
            key={`group-${groupIndex}`}
            ref={groupIndex === 0 ? firstGroupRef : undefined}
            className={styles.group}
            data-loop-group={groupIndex}
          >
            {sourceItems.map((item, itemIndex) => (
              <React.Fragment key={`${item.key}@${groupIndex}-${itemIndex}`}>
                {item.node}
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>

      <div aria-hidden className={`${styles.fade} ${styles.fadeLeft}`} />
      <div aria-hidden className={`${styles.fade} ${styles.fadeRight}`} />

      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowLeft}`}
        aria-label="前へスクロール"
        disabled={!canScroll}
        onClick={() => scrollBy(-1)}
      >
        <Icon name="chevron-left" size={20} aria-hidden />
      </button>
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowRight}`}
        aria-label="次へスクロール"
        disabled={!canScroll}
        onClick={() => scrollBy(1)}
      >
        <Icon name="chevron-right" size={20} aria-hidden />
      </button>
    </div>
  );
}
