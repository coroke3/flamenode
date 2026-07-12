"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

interface ShelfProps {
  children: React.ReactNode;
  ariaLabel?: string;
  density?: "default" | "compact";
}

/**
 * 横スクロール棚。デスクトップでは左右の半透明矢印を出す。
 * `prefers-reduced-motion` を尊重し、自動スクロールはしない (UX とコスト両面で安全)。
 */
export function Shelf({
  children,
  ariaLabel,
  density = "default",
}: ShelfProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<number | null>(null);
  const resumeTimerRef = React.useRef<number | null>(null);
  const pausedRef = React.useRef(false);
  const pointerActiveRef = React.useRef(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);

  const setPaused = React.useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

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
    if (!el || reducedMotion) return;

    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      if (!pausedRef.current && el.scrollWidth > el.clientWidth + 4) {
        el.scrollLeft += Math.min(elapsed, 80) * 0.018;
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
          el.scrollLeft = 0;
        }
        update();
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    };
  }, [reducedMotion, update]);

  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    setPaused(true);
    el.scrollBy({ left: el.clientWidth * 0.85 * dir, behavior: "smooth" });
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      setPaused(false);
      resumeTimerRef.current = null;
    }, 1400);
  };

  const items = React.Children.toArray(children);

  return (
    <div className="fn-shelf-wrapper" data-density={density}>
      <div
        ref={ref}
        className="fn-shelf"
        data-density={density}
        role="region"
        aria-label={ariaLabel}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => {
          if (!pointerActiveRef.current) setPaused(false);
        }}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPaused(false);
          }
        }}
        onPointerDown={(event) => {
          pointerActiveRef.current = true;
          setPaused(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          pointerActiveRef.current = false;
          setPaused(false);
        }}
        onPointerCancel={() => {
          pointerActiveRef.current = false;
          setPaused(false);
        }}
      >
        {items}
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
