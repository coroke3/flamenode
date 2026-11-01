import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OpsLink as Link } from "./OpsLink.js";
import { Icon } from "./Icon.js";
function variantClass(variant) {
    switch (variant) {
        case "primary":
            return "fn-btn fn-btn-primary fn-btn-sm";
        case "danger":
            return "fn-btn fn-btn-danger fn-btn-sm";
        case "ghost":
        default:
            return "fn-btn fn-btn-ghost fn-btn-sm";
    }
}
export function ConsolePageHeader({ title, description, backHref, backLabel = "戻る", actions = [], accent = false, children, }) {
    return (_jsxs("header", { className: accent ? "fn-console-head manage-event-hero" : "fn-console-head", children: [_jsxs("div", { className: "fn-console-head-main", children: [backHref ? (_jsx("p", { className: "fn-console-back", children: _jsxs(Link, { href: backHref, children: [_jsx(Icon, { name: "chevron-left", size: 12, "aria-hidden": true }), " ", backLabel] }) })) : null, _jsx("h1", { className: "fn-console-title", children: title }), description ? (_jsx("div", { className: "fn-console-lead", children: description })) : null, children ? (_jsx("div", { className: "fn-console-head-actions", children: children })) : null] }), actions.length > 0 ? (_jsx("div", { className: "fn-console-actions", children: actions.map((action) => (_jsxs(Link, { href: action.href, className: variantClass(action.variant), children: [action.icon, action.label] }, action.href))) })) : null] }));
}
