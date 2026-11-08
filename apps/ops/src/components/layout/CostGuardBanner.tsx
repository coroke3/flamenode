// MIG-0726 U02 (D-17-6): shared CostGuardBanner, admin source. MIG-0719 adds the public source.
import * as React from "react";
import type { CostGuardBannerResponse } from "../../api/adminBanner.js";
import { fetchCostGuardBanner } from "../../api/adminBanner.js";
import { loadOperationMode } from "../../api/operationMode.js";
import { useApiResult } from "../../routes/useApiResult.js";

type VisibleMode = Exclude<CostGuardBannerResponse["mode"], "normal">;

const WARNING = {
  bg: "var(--accent-warning-soft, #fff3cd)",
  border: "var(--accent-warning, #d97706)",
  color: "var(--accent-warning, #b45309)",
};
const DANGER = {
  bg: "var(--accent-danger-soft, #f8d7da)",
  border: "var(--accent-danger, #dc2626)",
  color: "var(--accent-danger, #991b1b)",
};
/** Copied from CURRENT src/components/layout/CostGuardBanner.tsx TONE. */
export const COST_GUARD_TONE: Record<VisibleMode, typeof WARNING & { label: string; description: string }> = {
  economy: { ...WARNING, label: "省コストモード", description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。" },
  read_only: { ...WARNING, label: "読み取り専用モード", description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。" },
  static_only: { ...WARNING, label: "静的JSONモード", description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。" },
  maintenance: { ...DANGER, label: "メンテナンス中", description: "サイトはメンテナンス中です。一部機能が利用できません。" },
};

export function CostGuardBannerView({
  mode, reason, source = "admin",
}: CostGuardBannerResponse & { source?: "admin" | "manage" }): React.ReactElement | null {
  if (mode === "normal") return null;
  const tone = COST_GUARD_TONE[mode];
  return (
    <div
      role="status"
      aria-live="polite"
      className={source === "manage" ? "costguard-banner" : "cost-guard-banner"}
      style={{ background: tone.bg, borderBottomColor: tone.border, color: tone.color }}
    >
      <div className={source === "manage" ? "fn-public-container costguard-inner" : "fn-public-container cost-guard-banner-inner"}>
        <strong>{tone.label}:</strong>
        <span>{tone.description}</span>
        {reason ? <em className={source === "manage" ? "costguard-reason" : "cost-guard-banner-reason"}>(理由: {reason})</em> : null}
      </div>
    </div>
  );
}

const defaultFetch = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

/** Any non-ok read (401/403/5xx) renders nothing, like CURRENT's `return null`; OpsGate owns redirects. */
export function CostGuardBanner({
  source = "admin", fetchFn = defaultFetch,
}: {
  source?: "admin" | "manage";
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}): React.ReactElement | null {
  const state = useApiResult(
    (signal) => source === "manage" ? loadOperationMode(fetchFn, signal) : fetchCostGuardBanner(fetchFn, signal),
    "cost-guard-banner:" + source,
  );
  if (state.status !== "ok") return null;
  return <CostGuardBannerView source={source} mode={state.data.mode} reason={state.data.reason} />;
}
