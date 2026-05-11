import * as React from "react";
import styles from "./Logo.module.css";
import { cn } from "@/lib/utils/cn";

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({
  size = 28,
  showText = true,
  className,
}: LogoProps): React.ReactElement {
  return (
    <span className={cn(styles.root, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={styles.icon}
        aria-hidden
      />
      {showText ? (
        <span className={styles.text}>
          <span className={styles.title}>FlameNode</span>
          <span className={styles.sub}>Frame + Node</span>
        </span>
      ) : null}
    </span>
  );
}
