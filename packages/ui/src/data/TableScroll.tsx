import React from "react";

export interface TableScrollProps {
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Accessible horizontal scrolling container for tabular data.
 */
export function TableScroll({
  children,
  ariaLabel = "データ表",
  className,
}: TableScrollProps): React.ReactElement {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      className={cx("fn-table-scroll", className)}
    >
      {children}
    </div>
  );
}
