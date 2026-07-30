"use client";

import * as React from "react";
import { flushSync } from "react-dom";
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
  /** 端でカードを1件ずつローテートし、継ぎ目なしの連続スクロールにする。 */
  loop?: boolean;
  /** カードが画面上で流れる向き。 */
  autoScrollDirection?: "left" | "right";
}

type SourceItem = {
  sourceKey: string;
  node: React.ReactNode;
};

type LoopItem = SourceItem & {
  displayKey: string;
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

function getShelfGap(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const raw = style.columnGap || style.gap || "0";
  const gap = Number.parseFloat(raw);
  return Number.isFinite(gap) ? gap : 0;
}

function getItemStride(el: HTMLElement, itemEl: HTMLElement): number {
  return itemEl.offsetWidth + getShelfGap(el);
}

function getLoopRotateCount(mobileRows: 1 | 2): number {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return 1;
  }
  if (
    window.matchMedia("(max-width: 700px)").matches &&
    mobileRows === 2
  ) {
    return 2;
  }
  return 1;
}

function ensureColumnAligned(items: LoopItem[], rotateCount: number): LoopItem[] {
  if (rotateCount <= 1 || items.length % rotateCount === 0) return items;
  const padCount = rotateCount - (items.length % rotateCount);
  const padded = [...items];
  for (let i = 0; i < padCount; i++) {
    const source = items[i % rotateCount];
    padded.push({
      ...source,
      displayKey: `${source.sourceKey}@pad-${padded.length}`,
    });
  }
  return padded;
}

type LoopNormalizeMode = "forward" | "backward" | "both";

function normalizeLoopScroll(
  el: HTMLDivElement,
  rotateForward: (el: HTMLDivElement, count: number) => boolean,
  rotateBackward: (el: HTMLDivElement, count: number) => boolean,
  count: number,
  mode: LoopNormalizeMode = "both",
): void {
  if (mode === "forward" || mode === "both") {
    let guard = 0;
    while (guard < 8) {
      const first = el.children[0] as HTMLElement | undefined;
      if (!first) break;
      const stride = getItemStride(el, first);
      if (!(stride > 0) || el.scrollLeft < stride) break;
      if (!rotateForward(el, count)) break;
      guard += 1;
    }
  }
  if (mode === "backward" || mode === "both") {
    let guard = 0;
    while (guard < 8) {
      // 左端付近でのみ末尾→先頭へ移し、回転直後の stride 位置では再回転しない。
      if (el.scrollLeft > 1) break;
      if (!rotateBackward(el, count)) break;
      guard += 1;
    }
  }
}

function toLoopItems(sourceItems: SourceItem[], keyPrefix: string): LoopItem[] {
  return sourceItems.map((item, index) => ({
    ...item,
    displayKey: `${item.sourceKey}@${keyPrefix}-${index}`,
  }));
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
  const ensureScrollableAttemptsRef = React.useRef(0);
  const normalizingRef = React.useRef(false);
  const rightSeedAppliedRef = React.useRef(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [inViewport, setInViewport] = React.useState(true);
  const [documentVisible, setDocumentVisible] = React.useState(true);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);
  const sourceItems = React.useMemo(() => toSourceItems(children), [children]);
  const sourceSignature = React.useMemo(
    () => sourceItems.map((item) => item.sourceKey).join("|"),
    [sourceItems],
  );
  const [loopItems, setLoopItems] = React.useState<LoopItem[]>([]);

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

  const sourceItemsRef = React.useRef(sourceItems);
  sourceItemsRef.current = sourceItems;

  const rotateForward = React.useCallback((el: HTMLDivElement, count?: number): boolean => {
    const rotateCount = count ?? getLoopRotateCount(mobileRows);
    const first = el.children[0] as HTMLElement | undefined;
    if (!first || el.children.length < rotateCount + 1) return false;
    const movedWidth = getItemStride(el, first);
    if (!(movedWidth > 0)) return false;

    flushSync(() => {
      setLoopItems((prev) => {
        if (prev.length < rotateCount + 1) return prev;
        const head = prev.slice(0, rotateCount);
        const rest = prev.slice(rotateCount);
        const next = [...rest, ...head];
        return next.map((item, index) => ({
          ...item,
          displayKey: `${item.sourceKey}@f${index}`,
        }));
      });
    });
    el.scrollLeft = Math.max(0, el.scrollLeft - movedWidth);
    return true;
  }, [mobileRows]);

  const rotateBackward = React.useCallback((el: HTMLDivElement, count?: number): boolean => {
    const rotateCount = count ?? getLoopRotateCount(mobileRows);
    const first = el.children[0] as HTMLElement | undefined;
    if (!first || el.children.length < rotateCount + 1) return false;
    const movedWidth = getItemStride(el, first);
    if (!(movedWidth > 0)) return false;

    flushSync(() => {
      setLoopItems((prev) => {
        if (prev.length < rotateCount + 1) return prev;
        const tail = prev.slice(-rotateCount);
        const rest = prev.slice(0, -rotateCount);
        const next = [...tail, ...rest];
        return next.map((item, index) => ({
          ...item,
          displayKey: `${item.sourceKey}@b${index}`,
        }));
      });
    });
    el.scrollLeft += movedWidth;
    return true;
  }, [mobileRows]);

  React.useEffect(() => {
    directionRef.current = autoScrollDirection === "left" ? 1 : -1;
  }, [autoScrollDirection]);

  // children 参照は毎レンダー変わるので、キー署名が変わったときだけ再同期する。
  React.useLayoutEffect(() => {
    if (!loop) {
      ensureScrollableAttemptsRef.current = 0;
      rightSeedAppliedRef.current = false;
      setLoopItems([]);
      return;
    }
    ensureScrollableAttemptsRef.current = 0;
    rightSeedAppliedRef.current = false;
    const rotateCount = getLoopRotateCount(mobileRows);
    setLoopItems(
      ensureColumnAligned(
        toLoopItems(sourceItemsRef.current, "init"),
        rotateCount,
      ),
    );
  }, [loop, sourceSignature, density, mobileRows]);

  React.useLayoutEffect(() => {
    if (!loop) return;
    const el = ref.current;
    const sources = sourceItemsRef.current;
    if (!el || loopItems.length === 0 || sources.length === 0) return;
    if (el.scrollWidth > el.clientWidth + 4) {
      ensureScrollableAttemptsRef.current = 0;
      if (
        autoScrollDirection === "right" &&
        !rightSeedAppliedRef.current
      ) {
        rightSeedAppliedRef.current = true;
        rotateBackward(el, getLoopRotateCount(mobileRows));
      }
      update();
      return;
    }
    if (ensureScrollableAttemptsRef.current >= 8) {
      update();
      return;
    }

    const round = Math.floor(loopItems.length / sources.length);
    ensureScrollableAttemptsRef.current += 1;
    const rotateCount = getLoopRotateCount(mobileRows);
    setLoopItems((prev) =>
      ensureColumnAligned(
        [...prev, ...toLoopItems(sources, `fill-${round}`)],
        rotateCount,
      ),
    );
  }, [autoScrollDirection, loop, loopItems.length, mobileRows, rotateBackward, sourceSignature, update]);

  const handleScroll = React.useCallback(() => {
    update();
    if (!loop) return;
    const el = ref.current;
    if (!el || normalizingRef.current) return;
    if (el.scrollWidth <= el.clientWidth + 4) return;
    normalizingRef.current = true;
    try {
      const count = getLoopRotateCount(mobileRows);
      normalizeLoopScroll(el, rotateForward, rotateBackward, count, "both");
    } finally {
      normalizingRef.current = false;
    }
  }, [loop, mobileRows, rotateBackward, rotateForward, update]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    handleScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", update);
    };
  }, [handleScroll, loopItems.length, update]);

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
          normalizingRef.current = true;
          try {
            el.scrollLeft = next;
            const count = getLoopRotateCount(mobileRows);
            normalizeLoopScroll(
              el,
              rotateForward,
              rotateBackward,
              count,
              directionRef.current === 1 ? "forward" : "backward",
            );
            next = el.scrollLeft;
          } finally {
            normalizingRef.current = false;
          }
        } else {
          const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
          if (next >= maxScroll) {
            next = maxScroll;
            directionRef.current = -1;
          } else if (next <= 0) {
            next = 0;
            directionRef.current = 1;
          }
          el.scrollLeft = next;
        }
        update();
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
    documentVisible,
    inViewport,
    loop,
    mobileRows,
    reducedMotion,
    rotateBackward,
    rotateForward,
    update,
  ]);

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

  const renderLoopItem = (item: LoopItem) => {
    if (React.isValidElement(item.node)) {
      return React.cloneElement(item.node, { key: item.displayKey });
    }
    return <React.Fragment key={item.displayKey}>{item.node}</React.Fragment>;
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
        {loop ? loopItems.map(renderLoopItem) : children}
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
