import * as React from "react";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";

export function SaveSuccessNotice({
  message,
  pendingPublicReflection,
  className,
  style,
}: {
  message: React.ReactNode;
  pendingPublicReflection?: boolean;
  className?: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      role="status"
      className={className ?? "fn-success"}
      style={style}
    >
      <div>{message}</div>
      {pendingPublicReflection ? (
        <div style={{ marginTop: 8 }}>
          <PublicReflectionDelayNotice />
        </div>
      ) : null}
    </div>
  );
}
