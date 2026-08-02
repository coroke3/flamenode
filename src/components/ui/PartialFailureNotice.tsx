import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function PartialFailureNotice({
  title = "一部の処理に失敗しました。",
  items,
  className,
}: {
  title?: string;
  items: readonly string[];
  className?: string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className={className ?? "fn-alert fn-alert-warning"} role="alert">
      <Icon name="info" size={16} aria-hidden />
      <div>
        <p style={{ margin: 0 }}>{title}</p>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
