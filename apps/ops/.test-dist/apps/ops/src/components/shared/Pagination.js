import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { OpsLink as Link } from "./OpsLink.js";
import { Icon } from "./Icon.js";
function pageNumbers(current, total) {
    const out = [];
    const spread = 2;
    const start = Math.max(1, current - spread);
    const end = Math.min(total, current + spread);
    if (start > 1) {
        out.push(1);
        if (start > 2)
            out.push("…");
    }
    for (let i = start; i <= end; i++)
        out.push(i);
    if (end < total) {
        if (end < total - 1)
            out.push("…");
        out.push(total);
    }
    return out;
}
export function Pagination({ currentPage, totalPages, total, buildHref, unitLabel = "件", pageSize, }) {
    if (totalPages <= 1)
        return null;
    const pages = pageNumbers(currentPage, totalPages);
    const rangeStart = pageSize ? (currentPage - 1) * pageSize + 1 : null;
    const rangeEnd = pageSize ? Math.min(currentPage * pageSize, total) : null;
    return (_jsxs("nav", { "aria-label": "\u30DA\u30FC\u30B8\u9001\u308A", style: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginTop: 12,
            fontSize: 12,
            color: "var(--text-muted)",
        }, children: [_jsxs("span", { style: { marginRight: 8 }, children: [rangeStart != null && rangeEnd != null && total > 0
                        ? `${rangeStart}〜${rangeEnd} / 全 ${total} ${unitLabel}`
                        : `全 ${total} ${unitLabel}`, totalPages > 1 ? ` (${currentPage} / ${totalPages} ページ)` : null] }), currentPage > 1 ? (_jsxs(Link, { href: buildHref(currentPage - 1), className: "fn-btn fn-btn-ghost fn-btn-sm", "aria-label": "\u524D\u306E\u30DA\u30FC\u30B8", prefetch: false, children: [_jsx(Icon, { name: "chevron-left", size: 12, "aria-hidden": true }), "\u524D\u3078"] })) : (_jsxs("span", { className: "fn-btn fn-btn-ghost fn-btn-sm", "aria-disabled": true, style: { opacity: 0.4, pointerEvents: "none" }, children: [_jsx(Icon, { name: "chevron-left", size: 12, "aria-hidden": true }), " \u524D\u3078"] })), pages.map((p, i) => p === "…" ? (_jsx("span", { style: { padding: "0 4px" }, children: "\u2026" }, `gap-${i}`)) : (_jsx(Link, { href: buildHref(p), className: `fn-btn fn-btn-sm ${p === currentPage ? "fn-btn-primary" : "fn-btn-ghost"}`, "aria-current": p === currentPage ? "page" : undefined, style: { minWidth: 30, justifyContent: "center" }, prefetch: false, children: p }, p))), currentPage < totalPages ? (_jsxs(Link, { href: buildHref(currentPage + 1), className: "fn-btn fn-btn-ghost fn-btn-sm", "aria-label": "\u6B21\u306E\u30DA\u30FC\u30B8", prefetch: false, children: ["\u6B21\u3078", _jsx(Icon, { name: "chevron-right", size: 12, "aria-hidden": true })] })) : (_jsxs("span", { className: "fn-btn fn-btn-ghost fn-btn-sm", "aria-disabled": true, style: { opacity: 0.4, pointerEvents: "none" }, children: ["\u6B21\u3078 ", _jsx(Icon, { name: "chevron-right", size: 12, "aria-hidden": true })] }))] }));
}
