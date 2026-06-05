import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 幅の広い表をスマホで横スクロールさせるラッパ。
 * `.fn-table-scroll`（globals.css / mobile-public.css）と併用する。
 */
export function TableScroll({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <div className={cn("fn-table-scroll", className)}>{children}</div>;
}
