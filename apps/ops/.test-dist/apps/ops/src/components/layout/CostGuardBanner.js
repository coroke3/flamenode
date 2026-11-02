import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { fetchCostGuardBanner } from "../../api/adminBanner.js";
import { useApiResult } from "../../routes/useApiResult.js";
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
export const COST_GUARD_TONE = {
    economy: { ...WARNING, label: "省コストモード", description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。" },
    read_only: { ...WARNING, label: "読み取り専用モード", description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。" },
    static_only: { ...WARNING, label: "静的JSONモード", description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。" },
    maintenance: { ...DANGER, label: "メンテナンス中", description: "サイトはメンテナンス中です。一部機能が利用できません。" },
};
export function CostGuardBannerView({ mode, reason, }) {
    if (mode === "normal")
        return null;
    const tone = COST_GUARD_TONE[mode];
    return (_jsx("div", { role: "status", "aria-live": "polite", className: "cost-guard-banner", style: { background: tone.bg, borderBottomColor: tone.border, color: tone.color }, children: _jsxs("div", { className: "fn-public-container cost-guard-banner-inner", children: [_jsxs("strong", { children: [tone.label, ":"] }), _jsx("span", { children: tone.description }), reason ? _jsxs("em", { className: "cost-guard-banner-reason", children: ["(\u7406\u7531: ", reason, ")"] }) : null] }) }));
}
const defaultFetch = (input, init) => fetch(input, init);
/** Any non-ok read (401/403/5xx) renders nothing, like CURRENT's `return null`; OpsGate owns redirects. */
export function CostGuardBanner({ source = "admin", fetchFn = defaultFetch, }) {
    const state = useApiResult((signal) => fetchCostGuardBanner(fetchFn, signal), "cost-guard-banner:" + source);
    if (state.status !== "ok")
        return null;
    return _jsx(CostGuardBannerView, { mode: state.data.mode, reason: state.data.reason });
}
