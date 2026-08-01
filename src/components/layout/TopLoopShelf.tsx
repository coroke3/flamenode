"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import styles from "./TopLoopShelf.module.css";

interface TopLoopShelfProps {
  children: React.ReactNode;
  ariaLabel?: string;
  autoScrollSpeed?: number;
  mobileRows?: 1 | 2;
  pauseAfterInteractionMs?: number;
  pauseOnWheel?: boolean;
  autoScrollDirection?: "left" | "right";
}

type SourceItem = {
  sourceKey: string;
  node: React.ReactNode | null;
};

function toSourceItems(children: React.ReactNode): SourceItem[] {
  return React.Children.toArray(children).map((node, index) => ({
    sourceKey:
      React.isValidElement(node) && node.key != null
        ? String(node.key)
        : `shelf-${index}`,
    node,
  }));
}

function getElementGap(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const raw = style.columnGap || style.gap || "0";
  const gap = Number.parseFloat(raw);
  return Number.isFinite(gap) ? gap : 0;
}

function measureCycleWidth(
  scroller: HTMLElement,
  groupEl: HTMLElement,
): number {
  const width = groupEl.getBoundingClientRect().width;
  if (!(width > 0)) return 0;
  // scrollLeft は整数のため、周期も整数に揃えて継ぎ目ズレを防ぐ。
  return Math.max(1, Math.round(width + getElementGap(scroller)));
}

function isScrollerScrollable(scroller: HTMLElement): boolean {
  return scroller.scrollWidth > scroller.clientWidth + 4;
}

function isMobileTwoRows(mobileRows: 1 | 2): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 700px)").matches && mobileRows === 2;
}

function subscribeMaxWidth700(onStoreChange: () => void): () => void {
  const mq = window.matchMedia("(max-width: 700px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getMaxWidth700Snapshot(): boolean {
  return window.matchMedia("(max-width: 700px)").matches;
}

function getMaxWidth700ServerSnapshot(): boolean {
  return false;
}

function getScrollStride(
  scroller: HTMLElement,
  groupEl: HTMLElement | null,
  mobileRows: 1 | 2,
): number {
  if (!groupEl || groupEl.children.length === 0) {
    return scroller.clientWidth * 0.85;
  }
  const first = groupEl.children[0] as HTMLElement;
  const gap = getElementGap(groupEl);
  const cardStride = first.offsetWidth + gap;
  if (isMobileTwoRows(mobileRows)) {
    return cardStride;
  }
  return cardStride * 1.5;
}

function ensureColumnAligned(items: SourceItem[], rotateCount: number): SourceItem[] {
  if (rotateCount <= 1 || items.length % rotateCount === 0) return items;
  const padCount = rotateCount - (items.length % rotateCount);
  const padded = [...items];
  for (let i = 0; i < padCount; i++) {
    const source = items[i % rotateCount];
    padded.push({
      sourceKey: `${source.sourceKey}@pad-${padded.length}`,
      node: null,
    });
  }
  return padded;
}

function renderGroupItems(items: SourceItem[], groupIndex: number): React.ReactNode {
  return items.map((item, index) => {
    const key = `${item.sourceKey}@${groupIndex}-${index}`;
    if (item.node == null) {
      return <div key={key} aria-hidden="true" />;
    }
    if (React.isValidElement(item.node)) {
      return React.cloneElement(item.node, { key });
    }
    return <React.Fragment key={key}>{item.node}</React.Fragment>;
  });
}

/**
 * トップページ専用の無限ループ横スクロール棚。
 * 3グループ複製 + 中央開始 + scrollLeft テレポートで継ぎ目なくループする。
 */
export function TopLoopShelf({
  children,
  ariaLabel,
  autoScrollSpeed = 18,
  mobileRows = 2,
  pauseAfterInteractionMs = 1400,
  pauseOnWheel = true,
  autoScrollDirection = "left",
}: TopLoopShelfProps): React.ReactElement | null {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const group0Ref = React.useRef<HTMLDivElement>(null);
  const group1Ref = React.useRef<HTMLDivElement>(null);
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
  const directionRef = React.useRef<1 | -1>(
    autoScrollDirection === "left" ? 1 : -1,
  );
  const pointerActiveRef = React.useRef(false);
  const pauseReasonsRef = React.useRef({
    hover: false,
    focus: false,
    pointer: false,
    recentInteraction: false,
  });
  const canScrollRef = React.useRef({ prev: false, next: false });
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [inViewport, setInViewport] = React.useState(false);
  const [documentVisible, setDocumentVisible] = React.useState(true);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);
  const [needsLoop, setNeedsLoop] = React.useState(false);
  const needsLoopRef = React.useRef(false);
  needsLoopRef.current = needsLoop;
  const isMobileViewport = React.useSyncExternalStore(
    subscribeMaxWidth700,
    getMaxWidth700Snapshot,
    getMaxWidth700ServerSnapshot,
  );

  const sourceItems = React.useMemo(() => toSourceItems(children), [children]);
  // 2行グリッドは ≤700px のみ。PCで空の pad セルを出さない。
  const loopSourceItems = React.useMemo(
    () =>
      mobileRows === 2 && isMobileViewport
        ? ensureColumnAligned(sourceItems, 2)
        : sourceItems,
    [isMobileViewport, mobileRows, sourceItems],
  );
  const sourceSignature = React.useMemo(
    () => sourceItems.map((item) => item.sourceKey).join("|"),
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
    setPauseReason("recentInteraction", true);
    if (resumeTimerRef.current != null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setPauseReason("recentInteraction", false);
      resumeTimerRef.current = null;
    }, Math.max(0, Math.min(pauseAfterInteractionMs, 10_000)));
  }, [pauseAfterInteractionMs, setPauseReason]);

  const syncArrowState = React.useCallback((scroller: HTMLDivElement) => {
    if (needsLoopRef.current) {
      const scrollable = isScrollerScrollable(scroller);
      if (
        canScrollRef.current.prev === scrollable &&
        canScrollRef.current.next === scrollable
      ) {
        return;
      }
      canScrollRef.current = { prev: scrollable, next: scrollable };
      setCanPrev(scrollable);
      setCanNext(scrollable);
      return;
    }
    const nextPrev = scroller.scrollLeft > 4;
    const nextNext =
      scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4;
    if (
      canScrollRef.current.prev === nextPrev &&
      canScrollRef.current.next === nextNext
    ) {
      return;
    }
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
    // 1呼び出しあたり最大2周期（通常は1回で足りる）。過剰な while は避ける。
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
      const relativeOffset =
        (scroller.scrollLeft - previousCycleWidth) / previousCycleWidth;
      correctingRef.current = true;
      scroller.scrollLeft =
        nextCycleWidth + relativeOffset * nextCycleWidth;
      const minBound = nextCycleWidth * 0.45;
      const maxBound = nextCycleWidth * 1.55;
      if (scroller.scrollLeft < minBound || scroller.scrollLeft > maxBound) {
        scroller.scrollLeft = nextCycleWidth;
      }
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
  }, [
    sourceSignature,
    mobileRows,
    isMobileViewport,
    loopSourceItems.length,
    reevaluateLoopNeed,
  ]);

  React.useLayoutEffect(() => {
    if (!needsLoop) return;
    seedCenterScroll();
  }, [
    needsLoop,
    sourceSignature,
    mobileRows,
    isMobileViewport,
    loopSourceItems.length,
    seedCenterScroll,
  ]);

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
    const onResize = () => {
      reevaluateLoopNeed();
      if (needsLoopRef.current) updateCycleWidth(true);
    };
    window.addEventListener("resize", onResize);

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", onResize);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [
    handleScroll,
    reevaluateLoopNeed,
    sourceSignature,
    updateCycleWidth,
  ]);

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
  }, [
    reevaluateLoopNeed,
    sourceSignature,
    mobileRows,
    syncArrowState,
    updateCycleWidth,
  ]);

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
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
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
    const shouldAutoScroll =
      needsLoop &&
      sourceItems.length >= 2 &&
      autoScrollSpeed > 0 &&
      !reducedMotion &&
      inViewport &&
      documentVisible;

    if (!shouldAutoScroll || !scroller) return;

    let last = performance.now();
    autoScrollCarryRef.current = 0;
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;

      const cycleWidth = cycleWidthRef.current;
      const scrollable = isScrollerScrollable(scroller);
      if (
        !pausedRef.current &&
        scrollable &&
        cycleWidth > 0 &&
        sourceItems.length >= 2
      ) {
        const delta =
          Math.min(elapsed, 80) *
          (Math.min(autoScrollSpeed, 120) / 1000) *
          directionRef.current;
        // ブラウザの scrollLeft は整数化されるため、端数を持ち越す。
        autoScrollCarryRef.current += delta;
        const step =
          autoScrollCarryRef.current > 0
            ? Math.floor(autoScrollCarryRef.current)
            : Math.ceil(autoScrollCarryRef.current);
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
  }, [
    autoScrollSpeed,
    documentVisible,
    inViewport,
    needsLoop,
    reducedMotion,
    runScrollTeleport,
    sourceItems.length,
    sourceSignature,
    syncArrowState,
  ]);

  React.useEffect(() => () => {
    if (resumeTimerRef.current != null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
    if (animationRafRef.current != null) {
      window.cancelAnimationFrame(animationRafRef.current);
    }
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  const animateScrollBy = React.useCallback((
    scroller: HTMLDivElement,
    distance: number,
    onDone?: () => void,
  ) => {
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

  const scrollBy = React.useCallback((dir: -1 | 1) => {
    const scroller = scrollerRef.current;
    const group1 = group1Ref.current;
    if (!scroller) return;

    const distance = getScrollStride(scroller, group1, mobileRows) * dir;
    const finish = () => {
      if (needsLoopRef.current) scheduleScrollTeleport();
      syncArrowState(scroller);
    };

    if (reducedMotion) {
      correctingRef.current = true;
      scroller.scrollLeft += distance;
      correctingRef.current = false;
      finish();
    } else if (needsLoopRef.current) {
      animateScrollBy(scroller, distance, finish);
    } else {
      scroller.scrollBy({ left: distance, behavior: "smooth" });
      finish();
    }
    pauseAfterInteraction();
  }, [
    animateScrollBy,
    mobileRows,
    pauseAfterInteraction,
    reducedMotion,
    scheduleScrollTeleport,
    syncArrowState,
  ]);

  if (sourceItems.length === 0) {
    return null;
  }

  const showArrows = needsLoop && sourceItems.length >= 2;
  const interactionHandlers = {
    onMouseEnter: () => setPauseReason("hover", true),
    onMouseLeave: () => setPauseReason("hover", false),
    onFocusCapture: () => setPauseReason("focus", true),
    onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setPauseReason("focus", false);
      }
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
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "PageUp" ||
        event.key === "PageDown"
      ) {
        pauseAfterInteraction();
      }
    },
  };

  const displayItems = needsLoop ? loopSourceItems : sourceItems;
  const groupItems = renderGroupItems(displayItems, needsLoop ? 1 : 0);

  return (
    <div className={styles.fullBleed}>
      <div className={styles.wrapper}>
        <div
          ref={scrollerRef}
          className={styles.scroller}
          data-mobile-rows={mobileRows}
          data-auto-direction={autoScrollDirection}
          role="region"
          aria-label={ariaLabel}
          {...interactionHandlers}
        >
          {needsLoop ? (
            <>
              <div
                ref={group0Ref}
                className={styles.group}
                data-loop-group="0"
                aria-hidden="true"
                inert
              >
                {renderGroupItems(loopSourceItems, 0)}
              </div>
              <div
                ref={group1Ref}
                className={styles.group}
                data-loop-group="1"
              >
                {renderGroupItems(loopSourceItems, 1)}
              </div>
              <div
                className={styles.group}
                data-loop-group="2"
                aria-hidden="true"
                inert
              >
                {renderGroupItems(loopSourceItems, 2)}
              </div>
            </>
          ) : (
            <div ref={group1Ref} className={styles.group} data-loop-group="1">
              {groupItems}
            </div>
          )}
        </div>
        {showArrows ? (
          <>
            <div
              aria-hidden
              className={cn(styles.fadeLeft, canPrev && styles.isVisible)}
            />
            <div
              aria-hidden
              className={cn(styles.fadeRight, canNext && styles.isVisible)}
            />
            <button
              type="button"
              aria-label="前へスクロール"
              onClick={() => scrollBy(-1)}
              disabled={!canPrev}
              className={cn(styles.arrow, styles.arrowPrev)}
            >
              <Icon name="chevron-left" size={20} />
            </button>
            <button
              type="button"
              aria-label="次へスクロール"
              onClick={() => scrollBy(1)}
              disabled={!canNext}
              className={cn(styles.arrow, styles.arrowNext)}
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
