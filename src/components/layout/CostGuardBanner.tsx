import * as React from "react";
import { getDatabase } from "@/lib/cloudflare";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import { resolveCostGuardBannerSnapshot } from "@/lib/operationMode/publicMode";
import type { OperationMode } from "@/lib/operationMode/types";
import { readAdminSystemSettings } from "@/lib/admin/adminSystemSettings";
import styles from "./CostGuardBanner.module.css";

const TONE: Record<
  Exclude<OperationMode, "normal">,
  { bg: string; border: string; color: string; label: string; description: string }
> = {
  economy: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "省コストモード",
    description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。",
  },
  read_only: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "読み取り専用モード",
    description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。",
  },
  static_only: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "静的JSONモード",
    description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。",
  },
  maintenance: {
    bg: "var(--accent-danger-soft, #f8d7da)",
    border: "var(--accent-danger, #dc2626)",
    color: "var(--accent-danger, #991b1b)",
    label: "メンテナンス中",
    description: "サイトはメンテナンス中です。一部機能が利用できません。",
  },
};

type CostGuardBannerProps = {
  /** 管理画面向けは D1 正本を読む。公開向けは KV / env のみ。 */
  source?: "public" | "admin";
};

/**
 * operation_mode が normal 以外のとき、上部に簡易バナーを表示するサーバーコンポーネント。
 * 公開向けは D1 を毎回読まない。
 */
export async function CostGuardBanner({
  source = "public",
}: CostGuardBannerProps = {}): Promise<React.ReactElement | null> {
  let mode: OperationMode = "normal";
  let reason: string | null = null;

  if (source === "admin") {
    const db = getDatabase();
    if (!db) return null;
    try {
      const row = await readAdminSystemSettings(db);
      if (row) {
        mode = resolveOperationMode(row);
        reason = row.cost_guard_reason ?? null;
      }
    } catch {
      return null;
    }
  } else {
    const snapshot = await resolveCostGuardBannerSnapshot();
    if (!snapshot) return null;
    mode = snapshot.mode;
    reason = snapshot.reason;
  }

  if (mode === "normal") return null;
  const tone = TONE[mode];

  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.banner}
      style={{
        background: tone.bg,
        borderBottomColor: tone.border,
        color: tone.color,
      }}
    >
      <div className={`fn-public-container ${styles.inner}`}>
        <strong>{tone.label}:</strong>
        <span>{tone.description}</span>
        {reason ? <em className={styles.reason}>(理由: {reason})</em> : null}
      </div>
    </div>
  );
}
