"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

interface ShelfProps {
  children: React.ReactNode;
  ariaLabel?: string;
  density?: "default" | "compact";
  /** 自動送りを有効にする。reduced motion / 非表示中は常に停止する。 */
  autoScroll?: boolean;
  /** 自動送り速度（px/秒）。0 は自動送りなし。 */
  autoScrollSpeed?: number;
  /** 700px 以下での行数。デスクトップは常に1行。 */
  mobileRows?: 1 | 2;
  /** ユーザー操作後に自動送りを再開するまでの待機時間。 */
  pauseAfterInteractionMs?: number;
  /** ホイール操作で自動送りを一時停止する。 */
  pauseOnWheel?: boolean;
  /** 同じ内容を複製し、端で折り返さない連続ループにする。 */
  loop?: boolean;
  /** カードが画面上で流れる向き。 */
  autoScrollDirection?: "left" | "right";
}

/**
 * 横スクロール棚。デスクトップでは左右の半透明矢印を出す。
 * `prefers-reduced-motion` を尊重し、自動スクロールはしない (UX とコスト両面で安全)。
 */
export function Shelf({
  children,
  ariaLabel,
  density = "default",
  autoScroll = true,
  autoScrollSpeed = 18,
  mobileRows = 2,
  pauseAfterInteractionMs = 1400,
  pauseOnWheel = true,
  loop = false,
  autoScrollDirection = "left",
}: ShelfProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const loopGroupRef = React.useRef<HTMLDivElement>(null);
  const loopCycleWidthRef = React.useRef(0);
  const frameRef = React.useRef<number | null>(null);
  const resumeTimerRef = React.useRef<number | null>(null);
  const pausedRef = React.useRef(false);
  const directionRef = React.useRef<1 | -1>(
    autoScrollDirection === "left" ? 1 : -1,
  );
  const pointerActiveRef = React.useRef(false);
  const pauseReasonsRef = React.useRef({
    hover: false,
    focus: false,
    pointer: false,
    recent: false,
  });
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [inViewport, setInViewport] = React.useState(true);
  const [documentVisible, setDocumentVisible] = React.useState(true);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);
  const childItems = React.Children.toArray(children);

  const setPauseReason = React.useCallback((
    reason: keyof typeof pauseReasonsRef.current,
    active: boolean,
  ) => {
    pauseReasonsRef.current[reason] = active;
    pausedRef.current = Object.values(pauseReasonsRef.current).some(Boolean);
  }, []);

  const pauseAfterInteraction = React.useCallback(() => {
    setPauseReason("recent", true);
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      setPauseReason("recent", false);
      resumeTimerRef.current = null;
    }, Math.max(0, Math.min(pauseAfterInteractionMs, 10_000)));
  }, [pauseAfterInteractionMs, setPauseReason]);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (loop) {
      const canLoop = el.scrollWidth > el.clientWidth + 4;
      setCanPrev(canLoop);
      setCanNext(canLoop);
      return;
    }
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, [loop]);

  React.useEffect(() => {
    directionRef.current = autoScrollDirection === "left" ? 1 : -1;
  }, [autoScrollDirection]);

  React.useEffect(() => {
    if (!loop) {
      loopCycleWidthRef.current = 0;
      return;
    }
    const el = ref.current;
    const group = loopGroupRef.current;
    if (!el || !group) return;

    const syncLoopGeometry = () => {
      const nextWidth = group.getBoundingClientRect().width;
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      const previousWidth = loopCycleWidthRef.current;
      const previousOffset =
        previousWidth > 0
          ? ((el.scrollLeft - previousWidth) % previousWidth + previousWidth) %
            previousWidth
          : 0;
      loopCycleWidthRef.current = nextWidth;
      el.scrollLeft = nextWidth + Math.min(previousOffset, nextWidth);
      update();
    };

    syncLoopGeometry();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncLoopGeometry);
    observer?.observe(group);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [childItems.length, density, loop, mobileRows, update]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver ===
      "undefined"
    ) {
      setInViewport(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(el);
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
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !inViewport ||
      !documentVisible
    ) {
      return;
    }
    const el = ref.current;
    if (!el) return;

    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      if (!pausedRef.current && el.scrollWidth > el.clientWidth + 4) {
        const delta = Math.min(elapsed, 80) * (Math.min(autoScrollSpeed, 120) / 1000);
        let next = el.scrollLeft + delta * directionRef.current;
        if (loop) {
          const cycleWidth = loopCycleWidthRef.current;
          if (cycleWidth <= 0) {
            frameRef.current = window.requestAnimationFrame(tick);
            return;
          }
          while (next >= cycleWidth * 2) next -= cycleWidth;
          while (next < cycleWidth) next += cycleWidth;
        } else {
          const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
          if (next >= maxScroll) {
            next = maxScroll;
            directionRef.current = -1;
          } else if (next <= 0) {
            next = 0;
            directionRef.current = 1;
          }
        }
        el.scrollLeft = next;
        update();
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [autoScroll, autoScrollSpeed, documentVisible, inViewport, loop, reducedMotion, update]);

  React.useEffect(() => () => {
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
  }, []);

  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    if (!loop) directionRef.current = dir;
    el.scrollBy({ left: el.clientWidth * 0.85 * dir, behavior: "smooth" });
    pauseAfterInteraction();
  };

  return (
    <div
      className="fn-shelf-wrapper"
      data-density={density}
      data-loop={loop ? "true" : undefined}
    >
      <div
        ref={ref}
        className="fn-shelf"
        data-density={density}
        data-mobile-rows={mobileRows}
        data-loop={loop ? "true" : undefined}
        data-auto-direction={loop ? autoScrollDirection : undefined}
        role="region"
        aria-label={ariaLabel}
        onMouseEnter={() => setPauseReason("hover", true)}
        onMouseLeave={() => {
          setPauseReason("hover", false);
        }}
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
        onPointerLeave={() => {
          if (!pointerActiveRef.current) return;
          pointerActiveRef.current = false;
          setPauseReason("pointer", false);
          pauseAfterInteraction();
        }}
        onPointerCancel={() => {
          pointerActiveRef.current = false;
          setPauseReason("pointer", false);
          pauseAfterInteraction();
        }}
        onWheel={() => {
          if (pauseOnWheel) {
            pauseAfterInteraction();
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "PageUp" ||
            event.key === "PageDown"
          ) {
            pauseAfterInteraction();
          }
        }}
      >
        {loop ? (
          <div className="fn-shelf-loop-track">
            <div className="fn-shelf-loop-group" aria-hidden inert>
              {childItems}
            </div>
            <div ref={loopGroupRef} className="fn-shelf-loop-group">
              {childItems}
            </div>
            <div className="fn-shelf-loop-group" aria-hidden inert>
              {childItems}
            </div>
          </div>
        ) : (
          children
        )}
      </div>
      <div aria-hidden className={cn("fn-shelf-fade-left", canPrev && "is-visible")} />
      <div aria-hidden className={cn("fn-shelf-fade-right", canNext && "is-visible")} />
      <button
        type="button"
        aria-label="前へスクロール"
        onClick={() => scrollBy(-1)}
        disabled={!canPrev}
        className={cn("fn-shelf-arrow", "is-prev")}
      >
        <Icon name="chevron-left" size={20} />
      </button>
      <button
        type="button"
        aria-label="次へスクロール"
        onClick={() => scrollBy(1)}
        disabled={!canNext}
        className={cn("fn-shelf-arrow", "is-next")}
      >
        <Icon name="chevron-right" size={20} />
      </button>
    </div>
  );
}
