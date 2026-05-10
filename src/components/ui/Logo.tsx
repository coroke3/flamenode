import * as React from "react";
import styles from "./Logo.module.css";
import { cn } from "@/lib/utils/cn";

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

/**
 * FlameNode ロゴ。
 * 「フレーム（映像）の結節点（ノード）」を、矩形フレーム + 接続点で抽象化する。
 * 主アクセント (黄色) と現在の text-primary でテーマ追従する。
 */
export function Logo({ size = 28, showText = true, className }: LogoProps): React.ReactElement {
  return (
    <span className={cn(styles.root, className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden
        className={styles.icon}
      >
        <rect
          x="3"
          y="3"
          width="26"
          height="26"
          rx="4"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <line
          x1="10"
          y1="3"
          x2="10"
          y2="29"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.4"
        />
        <line
          x1="22"
          y1="3"
          x2="22"
          y2="29"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.4"
        />
        <line
          x1="10"
          y1="10"
          x2="22"
          y2="22"
          stroke="var(--accent-primary)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="10" cy="10" r="3" fill="var(--accent-primary)" />
        <circle cx="22" cy="22" r="3" fill="var(--accent-primary)" />
      </svg>
      {showText ? (
        <span className={styles.text}>
          <span className={styles.title}>FlameNode</span>
          <span className={styles.sub}>Frame · Node</span>
        </span>
      ) : null}
    </span>
  );
}
