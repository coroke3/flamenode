"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface TableScrollProps {
  className?: string;
  children: React.ReactNode;
  /** スクリーンリーダー向けの横スクロール説明 */
  label?: string;
}

/**
 * 幅の広い表を横スクロールさせるラッパ。
 * 左右フェードはスクロール位置に応じて表示する（軽量な scroll / resize のみ）。
 */
export function TableScroll({
  className,
  children,
  label = "横にスクロールして全体を表示できます",
}: TableScrollProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scrollable = el.scrollWidth > el.clientWidth + 2;
    setCanPrev(scrollable && el.scrollLeft > 2);
    setCanNext(
      scrollable && el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    );
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  return (
    <div className={cn("fn-hscroll-surface", className)}>
      <p className="fn-sr-only">{label}</p>
      <div
        ref={ref}
        className={cn(
          "fn-table-scroll fn-scroll-affordance",
          canPrev && "is-scroll-back",
          canNext && "is-scroll-forward",
        )}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn("fn-hscroll-fade-left", canPrev && "is-visible")}
      />
      <div
        aria-hidden
        className={cn("fn-hscroll-fade-right", canNext && "is-visible")}
      />
    </div>
  );
}
