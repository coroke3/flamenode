import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Read-only projection. No technical delivery action may be invoked from Manage.
const STATUS = { pending: "配信待ち", processing: "送信中", sent: "送信済み", failed: "失敗", dead_letter: "最終失敗", cancelled: "キャンセル" };
export function summarizePayload(json) {
    try {
        const value = JSON.parse(json);
        if (!value || typeof value !== "object" || Array.isArray(value))
            return "—";
        const content = value.content;
        if (typeof content !== "string")
            return "—";
        const first = content.trim().split("\n").find(Boolean) ?? "";
        return first.length > 80 ? first.slice(0, 80) + "…" : first || "—";
    }
    catch {
        return "—";
    }
}
export function NotificationOutboxSummary({ row }) {
    return _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [_jsx("span", { className: "fn-badge " + (row.status === "failed" || row.status === "dead_letter" ? "fn-badge-danger" : row.status === "processing" ? "fn-badge-warning" : "fn-badge-soft"), children: STATUS[row.status ?? ""] ?? row.status ?? "不明" }), _jsx("strong", { style: { fontSize: 13 }, children: row.type })] }), _jsxs("div", { style: { fontSize: 12, color: "var(--text-muted)" }, children: ["\u5B9B\u5148: ", row.recipient_user_id || "—"] }), summarizePayload(row.payload_json) !== "—" ? _jsx("div", { style: { fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: summarizePayload(row.payload_json) }) : null, row.last_error && (row.status === "failed" || row.status === "dead_letter" || row.status === "cancelled") ? _jsx("div", { style: { fontSize: 11, wordBreak: "break-all" }, children: row.last_error }) : null] });
}
