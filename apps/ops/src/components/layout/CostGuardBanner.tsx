import * as React from "react";
import { loadOperationMode, type OperationMode } from "../../api/operationMode.js";
import { useApiResult } from "../../routes/useApiResult.js";

const TONE: Record<Exclude<OperationMode, "normal">, { bg: string; border: string; color: string; label: string; description: string }> = {
  economy: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "省コストモード", description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。" },
  read_only: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "読み取り専用モード", description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。" },
  static_only: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "静的JSONモード", description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。" },
  maintenance: { bg: "var(--accent-danger-soft, #f8d7da)", border: "var(--accent-danger, #dc2626)", color: "var(--accent-danger, #991b1b)", label: "メンテナンス中", description: "サイトはメンテナンス中です。一部機能が利用できません。" },
};
export function CostGuardBanner({ fetchFn = fetch }: { fetchFn?: typeof fetch }): React.ReactElement | null {
  const result = useApiResult((signal) => loadOperationMode(fetchFn, signal), "manage-cost-guard");
  if (result.status !== "ok" || result.data.mode === "normal") return null;
  const tone = TONE[result.data.mode];
  return <div role="status" aria-live="polite" className="costguard-banner" style={{ background: tone.bg, borderBottomColor: tone.border, color: tone.color }}>
    <div className="fn-public-container costguard-inner"><strong>{tone.label}:</strong><span>{tone.description}</span>
      {result.data.reason ? <em className="costguard-reason">(理由: {result.data.reason})</em> : null}</div>
  </div>;
}
