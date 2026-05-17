import * as React from "react";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";

type Mode = "normal" | "economy" | "read_only" | "static_only" | "maintenance";

const TONE: Record<
  Exclude<Mode, "normal">,
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

/**
 * cost_guard_mode が normal 以外のとき、上部に簡易バナーを表示するサーバーコンポーネント。
 * DB アクセスに失敗した場合は何も出さない (静かに失敗)。
 */
export async function CostGuardBanner(): Promise<React.ReactElement | null> {
  const db = getDatabase();
  if (!db) return null;
  let mode: Mode = "normal";
  let maintenance = 0;
  let reason: string | null = null;
  try {
    const rows = await db.select().from(systemSettings).limit(1);
    const r = rows[0];
    if (r) {
      mode = (r.cost_guard_mode ?? "normal") as Mode;
      maintenance = r.is_maintenance_mode ?? 0;
      reason = r.cost_guard_reason ?? null;
    }
  } catch {
    return null;
  }

  // is_maintenance_mode が立っていれば maintenance バナーを優先表示
  const effectiveMode: Mode = maintenance === 1 ? "maintenance" : mode;
  if (effectiveMode === "normal") return null;
  const tone = TONE[effectiveMode];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: tone.bg,
        borderBottom: `1px solid ${tone.border}`,
        color: tone.color,
        padding: "6px 14px",
        fontSize: 12,
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <strong>{tone.label}:</strong>
      <span>{tone.description}</span>
      {reason ? <em style={{ fontStyle: "normal" }}>(理由: {reason})</em> : null}
    </div>
  );
}
