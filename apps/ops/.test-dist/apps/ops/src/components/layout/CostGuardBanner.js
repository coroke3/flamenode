import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { loadOperationMode } from "../../api/operationMode.js";
import { useApiResult } from "../../routes/useApiResult.js";
const TONE = {
    economy: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "省コストモード", description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。" },
    read_only: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "読み取り専用モード", description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。" },
    static_only: { bg: "var(--accent-warning-soft, #fff3cd)", border: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #b45309)", label: "静的JSONモード", description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。" },
    maintenance: { bg: "var(--accent-danger-soft, #f8d7da)", border: "var(--accent-danger, #dc2626)", color: "var(--accent-danger, #991b1b)", label: "メンテナンス中", description: "サイトはメンテナンス中です。一部機能が利用できません。" },
};
export function CostGuardBanner({ fetchFn = fetch }) {
    const result = useApiResult((signal) => loadOperationMode(fetchFn, signal), "manage-cost-guard");
    if (result.status !== "ok" || result.data.mode === "normal")
        return null;
    const tone = TONE[result.data.mode];
    return _jsx("div", { role: "status", "aria-live": "polite", className: "costguard-banner", style: { background: tone.bg, borderBottomColor: tone.border, color: tone.color }, children: _jsxs("div", { className: "fn-public-container costguard-inner", children: [_jsxs("strong", { children: [tone.label, ":"] }), _jsx("span", { children: tone.description }), result.data.reason ? _jsxs("em", { className: "costguard-reason", children: ["(\u7406\u7531: ", result.data.reason, ")"] }) : null] }) });
}
