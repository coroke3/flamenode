import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function DataUnavailableNotice({
  message = "データを取得できませんでした。",
  className,
}: {
  message?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={className ?? "fn-empty"} role="status">
      <Icon name="info" size={20} aria-hidden />
      <p className="fn-empty-message">{message}</p>
    </div>
  );
}
