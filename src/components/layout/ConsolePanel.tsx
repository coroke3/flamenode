import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ConsolePanelProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  tone?: "default" | "danger";
  separated?: boolean;
  compact?: boolean;
  className?: string;
}

export function ConsolePanel({
  children,
  title,
  tone = "default",
  separated = false,
  compact = false,
  className,
}: ConsolePanelProps): React.ReactElement {
  return (
    <section
      className={cn(
        "fn-console-panel",
        separated && "fn-console-panel--separated",
        compact && "fn-console-panel--compact",
        tone === "danger" && "fn-console-panel--danger",
        className,
      )}
    >
      {title ? <h2 className="fn-console-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}
