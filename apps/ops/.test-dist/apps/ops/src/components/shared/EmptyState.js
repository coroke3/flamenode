import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OpsLink as Link } from "./OpsLink.js";
import { Icon } from "./Icon.js";
import { cn } from "./cn.js";
function toneIcon(tone) {
    switch (tone) {
        case "success":
            return "check";
        case "warning":
            return "warning";
        case "danger":
            return "alert";
        default:
            return "info";
    }
}
function actionClass(variant) {
    switch (variant) {
        case "danger":
            return "fn-btn fn-btn-danger";
        case "ghost":
            return "fn-btn fn-btn-ghost";
        case "primary":
        default:
            return "fn-btn fn-btn-primary";
    }
}
export function EmptyState({ title, description, icon, iconName, actions, tone = "neutral", className, }) {
    const resolvedActions = actions ?? [];
    const iconNode = icon ??
        (iconName ? (_jsx(Icon, { name: iconName, size: 18, "aria-hidden": true })) : (_jsx(Icon, { name: toneIcon(tone), size: 18, "aria-hidden": true })));
    return (_jsxs("section", { className: cn("fn-empty-state", "empty-empty", `empty-tone-${tone}`, className), children: [_jsx("div", { className: "empty-icon", "aria-hidden": true, children: iconNode }), _jsx("h2", { className: "empty-title", children: title }), description ? _jsx("p", { className: "empty-description", children: description }) : null, resolvedActions.length > 0 ? (_jsx("div", { className: "empty-actions", children: resolvedActions.map((action) => (_jsx(Link, { href: action.href, className: actionClass(action.variant), children: action.label }, `${action.href}-${action.label}`))) })) : null] }));
}
