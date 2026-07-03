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
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);

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

  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth * 0.85 * dir, behavior: "smooth" });
  };

  return (
    <div className="fn-shelf-wrapper" data-density={density}>
      <div
        ref={ref}
        className="fn-shelf"
        data-density={density}
        role="region"
        aria-label={ariaLabel}
      >
        {children}
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
