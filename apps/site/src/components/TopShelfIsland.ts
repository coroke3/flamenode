import React from "react";

/**
 * Top page shelf Island (CURRENT `TopLoopShelf`, MIG-0507 U09). Endless loop by three copies of the cards, a
 * centred start and `scrollLeft` teleports; auto-scroll that pauses on focus / pointer down / recent interaction
 * (a plain mouse hover does not pause, as CURRENT), stops for reduced motion, a hidden tab and an off-screen shelf;
 * arrows and keyboard / wheel nudges. It takes over a statically rendered native shelf only after it has rendered
 * (see `mountTopShelves.ts`), so without script the page keeps the native horizontal scroll.
 * The card markup is the static HTML of the page (`html`), not re-created here.
 */
const h = React.createElement;

/** The `@media (max-width: 700px)` of `styles/screens.css` (`.tls`) must stay in sync with this. */
const MOBILE_SHELF_MAX_WIDTH_PX = 700;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_SHELF_MAX_WIDTH_PX}px)`;

export interface TopShelfCard {
  key: string;
  /** Inner HTML of the static `li.tp-shelf-i` (rank badge + card link), produced by the build. */
  html: string;
}

export interface TopShelfIslandProps {
  items: readonly TopShelfCard[];
  /** aria-label of the scroll region. */
  ariaLabel?: string;
  /** Auto-scroll speed (px/s). 0 disables auto-scroll. While a loop is possible it always auto-scrolls. */
  autoScrollSpeed?: number;
  /** Rows at 700px and below. Desktop is always one row. */
  mobileRows?: 1 | 2;
  /** Wait before auto-scroll resumes after a user interaction. */
  pauseAfterInteractionMs?: number;
  /** A wheel gesture pauses auto-scroll. */
  pauseOnWheel?: boolean;
  /** Direction in which the cards flow on screen. */
  autoScrollDirection?: "left" | "right";
  /** Called once the shelf has rendered, so the caller can remove the static fallback. */
  onReady?: () => void;
}

// `inner` is created once per card: React 19 resets innerHTML whenever the `dangerouslySetInnerHTML` object identity
// changes, which would wipe the tabindex of the clones on every re-render.
type SourceItem = { sourceKey: string; inner: { __html: string } | null };

function getShelfGap(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const gap = Number.parseFloat(style.columnGap || style.gap || "0");
  return Number.isFinite(gap) ? gap : 0;
}

function neutralizeCloneFocusables(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').forEach((el) => {
    if (el.getAttribute("tabindex") !== "-1") {
      el.setAttribute("data-loop-tabindex", el.getAttribute("tabindex") ?? "");
      el.setAttribute("tabindex", "-1");
    }
  });
}

function measureCycleWidth(scroller: HTMLElement, groupEl: HTMLElement): number {
  const width = groupEl.getBoundingClientRect().width;
  if (!(width > 0)) return 0;
  // scrollLeft is an integer, so the cycle is rounded too to avoid a seam.
  return Math.max(1, Math.round(width + getShelfGap(scroller)));
}

function isScrollerScrollable(scroller: HTMLElement): boolean {
  return scroller.scrollWidth > scroller.clientWidth + 4;
}

function subscribeMaxWidth700(onStoreChange: () => void): () => void {
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getMaxWidth700Snapshot = (): boolean => window.matchMedia(MOBILE_MEDIA_QUERY).matches;
const getMaxWidth700ServerSnapshot = (): boolean => false;

function getScrollStride(scroller: HTMLElement, groupEl: HTMLElement | null, useMobileStride: boolean): number {
  if (!groupEl || groupEl.children.length === 0) return scroller.clientWidth * 0.85;
  const first = groupEl.children[0] as HTMLElement;
  const cardStride = first.offsetWidth + getShelfGap(groupEl);
  return useMobileStride ? cardStride : cardStride * 1.5;
}

function ensureColumnAligned(items: SourceItem[], rotateCount: number): SourceItem[] {
  if (rotateCount <= 1 || items.length % rotateCount === 0) return items;
  const padCount = rotateCount - (items.length % rotateCount);
  const padded = [...items];
  for (let i = 0; i < padCount; i++) {
    const source = items[i % rotateCount];
    padded.push({ sourceKey: `${source.sourceKey}@pad-${padded.length}`, inner: null });
  }
  return padded;
}

function renderGroupItems(items: SourceItem[], groupIndex: number): React.ReactNode[] {
  return items.map((entry, index) => {
    const key = `${entry.sourceKey}@${groupIndex}-${index}`;
    if (entry.inner == null) return h("div", { key, "aria-hidden": "true", className: "tls-pad" });
    return h("div", { key, className: "tls-i", dangerouslySetInnerHTML: entry.inner });
  });
}

const ARROW_PATH = { prev: "M15 6l-6 6 6 6", next: "M9 6l6 6-6 6" } as const;

function Arrow(props: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }): React.ReactElement {
  return h(
    "button",
    {
      type: "button",
      "aria-label": props.dir === "prev" ? "前へスクロール" : "次へスクロール",
      onClick: props.onClick,
      disabled: props.disabled,
      className: `tls-arrow ${props.dir === "prev" ? "tls-prev" : "tls-next"}`,
    },
    h("svg", { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true", focusable: "false" }, h("path", { d: ARROW_PATH[props.dir] })),
  );
}

/** Endless horizontal shelf: 3 copies + centred start + `scrollLeft` teleport. */
export function TopShelfIsland({
  items,
  ariaLabel,
  autoScrollSpeed = 26,
  mobileRows = 2,
  pauseAfterInteractionMs = 1400,
  pauseOnWheel = true,
  autoScrollDirection = "left",
  onReady,
}: TopShelfIslandProps): React.ReactElement | null {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const group0Ref = React.useRef<HTMLDivElement>(null);
  const group1Ref = React.useRef<HTMLDivElement>(null);
  const group2Ref = React.useRef<HTMLDivElement>(null);
  const cycleWidthRef = React.useRef(0);
  const seededRef = React.useRef(false);
  const correctingRef = React.useRef(false);
  const scrollRafRef = React.useRef<number | null>(null);
  const animationRafRef = React.useRef<number | null>(null);
  const animatingRef = React.useRef(false);
  const frameRef = React.useRef<number | null>(null);
  const resumeTimerRef = React.useRef<number | null>(null);
  const pausedRef = React.useRef(false);
  const autoScrollCarryRef = React.useRef(0);
  const directionRef = React.useRef<1 | -1>(autoScrollDirection === "left" ? 1 : -1);
  const pointerActiveRef = React.useRef(false);
  const pauseReasonsRef = React.useRef({ focus: false, pointer: false, recentInteraction: false });
  const canScrollRef = React.useRef({ prev: false, next: false });
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [inViewport, setInViewport] = React.useState(false);
  const [documentVisible, setDocumentVisible] = React.useState(true);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);
  const [needsLoop, setNeedsLoop] = React.useState(false);
  const needsLoopRef = React.useRef(false);
  needsLoopRef.current = needsLoop;
  const isMobileViewport = React.useSyncExternalStore(subscribeMaxWidth700, getMaxWidth700Snapshot, getMaxWidth700ServerSnapshot);

  const sourceItems = React.useMemo<SourceItem[]>(() => items.map((item) => ({ sourceKey: item.key, inner: { __html: item.html } })), [items]);
  // The 2-row grid exists only at <=700px, so desktop never gets empty pad cells.
  const loopSourceItems = React.useMemo(
    () => (mobileRows === 2 && isMobileViewport ? ensureColumnAligned(sourceItems, 2) : sourceItems),
    [isMobileViewport, mobileRows, sourceItems],
  );
  const sourceSignature = React.useMemo(() => sourceItems.map((item) => item.sourceKey).join("|"), [sourceItems]);

  const setPauseReason = React.useCallback((reason: keyof typeof pauseReasonsRef.current, active: boolean) => {
    pauseReasonsRef.current[reason] = active;
    pausedRef.current = Object.values(pauseReasonsRef.current).some(Boolean);
  }, []);

  const pauseAfterInteraction = React.useCallback(() => {
    setPauseReason("recentInteraction", true);
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      setPauseReason("recentInteraction", false);
      resumeTimerRef.current = null;
    }, Math.max(0, Math.min(pauseAfterInteractionMs, 10_000)));
  }, [pauseAfterInteractionMs, setPauseReason]);

  const syncArrowState = React.useCallback((scroller: HTMLDivElement) => {
    if (needsLoopRef.current) {
      const scrollable = isScrollerScrollable(scroller);
      if (canScrollRef.current.prev === scrollable && canScrollRef.current.next === scrollable) return;
      canScrollRef.current = { prev: scrollable, next: scrollable };
      setCanPrev(scrollable);
      setCanNext(scrollable);
      return;
    }
    const nextPrev = scroller.scrollLeft > 4;
    const nextNext = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4;
    if (canScrollRef.current.prev === nextPrev && canScrollRef.current.next === nextNext) return;
    canScrollRef.current = { prev: nextPrev, next: nextNext };
    setCanPrev(nextPrev);
    setCanNext(nextNext);
  }, []);

  const runScrollTeleport = React.useCallback(() => {
    const scroller = scrollerRef.current;
    const cycleWidth = cycleWidthRef.current;
    if (!scroller || !(cycleWidth > 0) || correctingRef.current || animatingRef.current) return;

    const leftThreshold = cycleWidth * 0.5;
    const rightThreshold = cycleWidth * 1.5;
    // At most two cycles per call (one is normally enough); no open-ended while loop.
    for (let i = 0; i < 2; i += 1) {
      const scrollLeft = scroller.scrollLeft;
      if (scrollLeft < leftThreshold) {
        correctingRef.current = true;
        scroller.scrollLeft = scrollLeft + cycleWidth;
        correctingRef.current = false;
        continue;
      }
      if (scrollLeft > rightThreshold) {
        correctingRef.current = true;
        scroller.scrollLeft = scrollLeft - cycleWidth;
        correctingRef.current = false;
        continue;
      }
      break;
    }
  }, []);

  const scheduleScrollTeleport = React.useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      runScrollTeleport();
    });
  }, [runScrollTeleport]);

  const updateCycleWidth = React.useCallback((preserveOffset = true) => {
    const scroller = scrollerRef.current;
    const group0 = group0Ref.current;
    if (!scroller || !group0) return 0;

    const previousCycleWidth = cycleWidthRef.current;
    const nextCycleWidth = measureCycleWidth(scroller, group0);
    if (!(nextCycleWidth > 0)) return 0;

    if (preserveOffset && previousCycleWidth > 0) {
      const relativeOffset = (scroller.scrollLeft - previousCycleWidth) / previousCycleWidth;
      correctingRef.current = true;
      scroller.scrollLeft = nextCycleWidth + relativeOffset * nextCycleWidth;
      const minBound = nextCycleWidth * 0.45;
      const maxBound = nextCycleWidth * 1.55;
      if (scroller.scrollLeft < minBound || scroller.scrollLeft > maxBound) scroller.scrollLeft = nextCycleWidth;
      correctingRef.current = false;
    }

    cycleWidthRef.current = nextCycleWidth;
    return nextCycleWidth;
  }, []);

  const seedCenterScroll = React.useCallback(() => {
    const scroller = scrollerRef.current;
    const cycleWidth = updateCycleWidth(false);
    if (!scroller || !(cycleWidth > 0) || seededRef.current) return;
    seededRef.current = true;
    correctingRef.current = true;
    scroller.scrollLeft = cycleWidth;
    correctingRef.current = false;
  }, [updateCycleWidth]);

  React.useEffect(() => {
    directionRef.current = autoScrollDirection === "left" ? 1 : -1;
  }, [autoScrollDirection]);

  const reevaluateLoopNeed = React.useCallback(() => {
    const scroller = scrollerRef.current;
    const measureGroup = group1Ref.current ?? group0Ref.current;
    if (!scroller || !measureGroup || sourceItems.length === 0) return;

    if (sourceItems.length < 2) {
      setNeedsLoop(false);
      syncArrowState(scroller);
      return;
    }

    const fits = measureGroup.scrollWidth <= scroller.clientWidth + 4;
    setNeedsLoop((prev) => {
      const next = !fits;
      if (prev !== next) {
        seededRef.current = false;
        cycleWidthRef.current = 0;
      }
      return next;
    });
    syncArrowState(scroller);
  }, [sourceItems.length, syncArrowState]);

  React.useLayoutEffect(() => {
    seededRef.current = false;
    cycleWidthRef.current = 0;
    autoScrollCarryRef.current = 0;
    reevaluateLoopNeed();
  }, [sourceSignature, mobileRows, isMobileViewport, loopSourceItems.length, reevaluateLoopNeed]);

  React.useLayoutEffect(() => {
    if (!needsLoop) return;
    seedCenterScroll();
  }, [needsLoop, sourceSignature, mobileRows, isMobileViewport, loopSourceItems.length, seedCenterScroll]);

  React.useLayoutEffect(() => {
    if (!needsLoop) return;
    neutralizeCloneFocusables(group0Ref.current);
    neutralizeCloneFocusables(group2Ref.current);
  }, [needsLoop, sourceSignature, loopSourceItems.length]);

  React.useLayoutEffect(() => {
    if (needsLoop) return;
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollLeft === 0) return;
    correctingRef.current = true;
    scroller.scrollLeft = 0;
    correctingRef.current = false;
  }, [needsLoop]);

  const handleScroll = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    syncArrowState(scroller);
    if (!needsLoopRef.current || correctingRef.current || animatingRef.current) return;
    scheduleScrollTeleport();
  }, [scheduleScrollTeleport, syncArrowState]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    const onScrollEnd = () => {
      syncArrowState(scroller);
      if (needsLoopRef.current) runScrollTeleport();
    };
    scroller.addEventListener("scrollend", onScrollEnd, { passive: true });
    const onResize = () => {
      reevaluateLoopNeed();
      if (needsLoopRef.current) updateCycleWidth(true);
    };
    window.addEventListener("resize", onResize);

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      scroller.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("resize", onResize);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [handleScroll, reevaluateLoopNeed, sourceSignature, updateCycleWidth, runScrollTeleport, syncArrowState]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const group0 = group0Ref.current;
    const group1 = group1Ref.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      reevaluateLoopNeed();
      if (needsLoopRef.current) updateCycleWidth(true);
      syncArrowState(scroller);
    });
    observer.observe(scroller);
    if (group0) observer.observe(group0);
    if (group1) observer.observe(group1);
    return () => observer.disconnect();
  }, [reevaluateLoopNeed, sourceSignature, mobileRows, syncArrowState, updateCycleWidth]);

  // --- pause environment ---
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof IntersectionObserver === "undefined") {
      setInViewport(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInViewport(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [sourceSignature]);

  React.useEffect(() => {
    const sync = () => setDocumentVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const shouldAutoScroll = needsLoop && sourceItems.length >= 2 && autoScrollSpeed > 0 && !reducedMotion && inViewport && documentVisible;
    if (!shouldAutoScroll || !scroller) return;

    let last = performance.now();
    autoScrollCarryRef.current = 0;
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;

      const cycleWidth = cycleWidthRef.current;
      const scrollable = isScrollerScrollable(scroller);
      if (!pausedRef.current && !animatingRef.current && scrollable && cycleWidth > 0 && sourceItems.length >= 2) {
        const delta = Math.min(elapsed, 80) * (Math.min(autoScrollSpeed, 120) / 1000) * directionRef.current;
        // scrollLeft is rounded by the browser, so the fraction is carried over.
        autoScrollCarryRef.current += delta;
        const step = autoScrollCarryRef.current > 0 ? Math.floor(autoScrollCarryRef.current) : Math.ceil(autoScrollCarryRef.current);
        if (step !== 0) {
          autoScrollCarryRef.current -= step;
          correctingRef.current = true;
          scroller.scrollLeft += step;
          correctingRef.current = false;
          runScrollTeleport();
          syncArrowState(scroller);
        }
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [autoScrollSpeed, documentVisible, inViewport, needsLoop, reducedMotion, runScrollTeleport, sourceItems.length, sourceSignature, syncArrowState]);

  React.useEffect(
    () => () => {
      if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (animationRafRef.current != null) {
        window.cancelAnimationFrame(animationRafRef.current);
        animationRafRef.current = null;
      }
      animatingRef.current = false;
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  React.useEffect(() => {
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animateScrollBy = React.useCallback((scroller: HTMLDivElement, distance: number, onDone?: () => void) => {
    if (animationRafRef.current != null) {
      window.cancelAnimationFrame(animationRafRef.current);
      animationRafRef.current = null;
    }

    const start = scroller.scrollLeft;
    const target = start + distance;
    const duration = 280;
    const startTime = performance.now();
    animatingRef.current = true;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - t) ** 3;
      correctingRef.current = true;
      scroller.scrollLeft = start + (target - start) * eased;
      correctingRef.current = false;
      if (t < 1) {
        animationRafRef.current = window.requestAnimationFrame(step);
      } else {
        animationRafRef.current = null;
        animatingRef.current = false;
        onDone?.();
      }
    };
    animationRafRef.current = window.requestAnimationFrame(step);
  }, []);

  const scrollBy = React.useCallback(
    (dir: -1 | 1) => {
      const scroller = scrollerRef.current;
      const group1 = group1Ref.current;
      if (!scroller) return;

      const distance = getScrollStride(scroller, group1, mobileRows === 2 && isMobileViewport) * dir;
      const finish = () => {
        if (needsLoopRef.current) scheduleScrollTeleport();
        syncArrowState(scroller);
      };

      if (reducedMotion) {
        animatingRef.current = true;
        correctingRef.current = true;
        scroller.scrollLeft += distance;
        correctingRef.current = false;
        animatingRef.current = false;
        finish();
      } else if (needsLoopRef.current) {
        animatingRef.current = true;
        animateScrollBy(scroller, distance, finish);
      } else {
        scroller.scrollBy({ left: distance, behavior: "smooth" });
        finish();
      }
      pauseAfterInteraction();
    },
    [animateScrollBy, isMobileViewport, mobileRows, pauseAfterInteraction, reducedMotion, scheduleScrollTeleport, syncArrowState],
  );

  if (sourceItems.length === 0) return null;

  const showArrows = needsLoop && sourceItems.length >= 2;
  const interactionHandlers = {
    onFocusCapture: () => setPauseReason("focus", true),
    onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPauseReason("focus", false);
    },
    onPointerDown: () => {
      pointerActiveRef.current = true;
      setPauseReason("pointer", true);
    },
    onPointerUp: () => {
      pointerActiveRef.current = false;
      setPauseReason("pointer", false);
      pauseAfterInteraction();
    },
    onPointerLeave: () => {
      if (!pointerActiveRef.current) return;
      pointerActiveRef.current = false;
      setPauseReason("pointer", false);
      pauseAfterInteraction();
    },
    onPointerCancel: () => {
      pointerActiveRef.current = false;
      setPauseReason("pointer", false);
      pauseAfterInteraction();
    },
    onWheel: () => {
      if (pauseOnWheel) pauseAfterInteraction();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "PageUp" || event.key === "PageDown") {
        pauseAfterInteraction();
      }
    },
  };

  const groupItems = renderGroupItems(needsLoop ? loopSourceItems : sourceItems, needsLoop ? 1 : 0);

  return h(
    "div",
    { className: "tls" },
    h(
      "div",
      { className: "tls-wrap" },
      h(
        "div",
        {
          ref: scrollerRef,
          className: "tls-scroller",
          "data-mobile-rows": mobileRows,
          "data-auto-direction": autoScrollDirection,
          role: "region",
          "aria-label": ariaLabel,
          ...interactionHandlers,
        },
        needsLoop
          ? h(
              React.Fragment,
              null,
              h("div", { ref: group0Ref, className: "tls-group", "data-loop-group": "0", "aria-hidden": "true" }, renderGroupItems(loopSourceItems, 0)),
              h("div", { ref: group1Ref, className: "tls-group", "data-loop-group": "1" }, renderGroupItems(loopSourceItems, 1)),
              h("div", { ref: group2Ref, className: "tls-group", "data-loop-group": "2", "aria-hidden": "true" }, renderGroupItems(loopSourceItems, 2)),
            )
          : h("div", { ref: group1Ref, className: "tls-group", "data-loop-group": "1" }, groupItems),
      ),
      showArrows
        ? h(
            React.Fragment,
            null,
            h("div", { "aria-hidden": "true", className: `tls-fade tls-fade-l${canPrev ? " on" : ""}` }),
            h("div", { "aria-hidden": "true", className: `tls-fade tls-fade-r${canNext ? " on" : ""}` }),
            h(Arrow, { dir: "prev", disabled: !canPrev, onClick: () => scrollBy(-1) }),
            h(Arrow, { dir: "next", disabled: !canNext, onClick: () => scrollBy(1) }),
          )
        : null,
    ),
  );
}

export default TopShelfIsland;
