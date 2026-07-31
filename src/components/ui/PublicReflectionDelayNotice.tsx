import * as React from "react";
import { PUBLIC_REFLECTION_DELAY_MESSAGE } from "@/lib/staticRebuild/publicReflectionNotice";

export function PublicReflectionDelayNotice({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <p
      className={className ?? "fn-muted fn-text-sm"}
      style={{ margin: 0 }}
    >
      {PUBLIC_REFLECTION_DELAY_MESSAGE}
    </p>
  );
}
