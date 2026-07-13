import * as React from "react";
import styles from "./Logo.module.css";
import { cn } from "@/lib/utils/cn";

/** FlameNode共通ロゴマーク */
const LOGO_MARK_PATH =
  "M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z";

interface LogoProps {
  size?: number;
  showText?: boolean;
  /** フッター等で NODE.0426 を出す場合のみ */
  showSub?: boolean;
  className?: string;
}

export function Logo({
  size = 24,
  showText = true,
  showSub = false,
  className,
}: LogoProps): React.ReactElement {
  const markWidth = Math.round(size * (693 / 840));

  return (
    <span className={cn(styles.root, "fn-logo", className)}>
      <span className="fn-logo-mark" aria-hidden>
        <svg
          viewBox="0 0 693 840"
          width={markWidth}
          height={size}
          fill="currentColor"
          focusable="false"
        >
          <path d={LOGO_MARK_PATH} />
        </svg>
      </span>
      {showText ? (
        <span className={cn(styles.text, "fn-logo-name", "fn-display")}>
          <span className={styles.title}>FlameNode</span>
          {showSub ? <span className={styles.sub}>NODE.0426</span> : null}
        </span>
      ) : null}
    </span>
  );
}
