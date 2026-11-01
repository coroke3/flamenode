import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Port of CURRENT src/components/admin/AdminResourceTabs.tsx (MIG-0707 U05, D-17-6). Same output.
import { OpsLink as Link } from "./OpsLink.js";
import { Icon } from "./Icon.js";
export function AdminResourceTabs({ tabs, active, ariaLabel, className = "fn-console-resource-tabs", }) {
    return (_jsx("nav", { className: className, "aria-label": ariaLabel, children: tabs.map((tab) => {
            const isActive = tab.key === active;
            return (_jsxs(Link, { href: tab.href, className: `fn-btn fn-btn-sm ${isActive ? "fn-btn-primary" : "fn-btn-ghost"}`, "aria-current": isActive ? "page" : undefined, children: [_jsx(Icon, { name: tab.icon, size: 11, "aria-hidden": true }), tab.label] }, tab.key));
        }) }));
}
