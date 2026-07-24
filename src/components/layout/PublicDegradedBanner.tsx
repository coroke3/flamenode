import * as React from "react";
import { getPublicRequestMetricsSnapshot } from "@/lib/observability/publicRequestMetrics";
import styles from "./CostGuardBanner.module.css";

/**
 * degraded_d1 表示時の簡易バナー。
 * 子ページの loader 完了後に評価するため PublicMetricsShell 内で children の直後に置く。
 */
export function PublicDegradedBanner(): React.ReactElement | null {
  const snapshot = getPublicRequestMetricsSnapshot();
  if (snapshot?.public_data_mode !== "degraded_d1") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.banner}
      style={{
        background: "var(--accent-warning-soft, #fff3cd)",
        borderBottomColor: "var(--accent-warning, #d97706)",
        color: "var(--accent-warning, #b45309)",
        order: -1,
      }}
    >
      <div className={`fn-public-container ${styles.inner}`}>
        <strong>簡易表示:</strong>
        <span>
          現在、公開データを簡易表示しています。
          一部の集計や並べ替えは利用できません。
        </span>
      </div>
    </div>
  );
}
