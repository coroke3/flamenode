"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function RetryCurrentPageButton({
  label = "再読み込み",
  className,
}: {
  label?: string;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={className ?? "fn-btn fn-btn-ghost fn-btn-sm"}
      onClick={() => window.location.reload()}
    >
      <Icon name="refresh" size={12} aria-hidden />
      {label}
    </button>
  );
}
