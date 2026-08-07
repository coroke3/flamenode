import * as React from "react";
import styles from "./Logo.module.css";
import { cn } from "@/lib/utils/cn";

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({
  size = 24,
  showText = true,
  className,
}: LogoProps): React.ReactElement {
  const logoStyle = {
    "--fn-logo-size": `${size}px`,
  } as React.CSSProperties;

  return (
    <span className={cn(styles.root, "fn-logo", className)} style={logoStyle}>
      <span className="fn-logo-mark" aria-hidden>
        <span className={styles.markAsset} />
      </span>
      {showText ? (
        <span className={cn(styles.text, "fn-logo-name")}>
          <span className={styles.title}>
            <span className={styles.visuallyHidden}>FlameNode</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
