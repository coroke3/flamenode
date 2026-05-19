import * as React from "react";
import styles from "./PageShell.module.css";

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  maxWidth?: "narrow" | "default" | "wide";
  className?: string;
}

export function PageShell({
  children,
  maxWidth = "default",
  className,
  ...props
}: PageShellProps): React.ReactElement {
  const containerClass = React.useMemo(() => {
    if (maxWidth === "narrow") return styles.containerNarrow;
    if (maxWidth === "wide") return styles.containerWide;
    return styles.containerDefault;
  }, [maxWidth]);

  return (
    <div className={`${styles.shell} ${className || ""}`} {...props}>
      <div className={`${styles.container} ${containerClass}`}>
        {children}
      </div>
    </div>
  );
}
