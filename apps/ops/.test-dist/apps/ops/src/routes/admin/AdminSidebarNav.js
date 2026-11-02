import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { useLocation } from "react-router-dom";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { buildAdminNavGroups } from "./AdminNavGroups.js";
/** CURRENT AdminSidebarNav semantics: query-specialized entries take priority over plain paths. */
export function isAdminNavActive(href, pathname, search, groups) {
    const [hrefPath, hrefQuery] = href.split("?");
    const params = new URLSearchParams(search);
    if (hrefQuery) {
        if (pathname !== hrefPath)
            return false;
        for (const [key, value] of new URLSearchParams(hrefQuery)) {
            if (params.get(key) !== value)
                return false;
        }
        return true;
    }
    const specialized = groups.some((group) => group.items.some((item) => {
        const [path, query] = item.href.split("?");
        if (!query || path !== hrefPath || pathname !== path)
            return false;
        for (const [key, value] of new URLSearchParams(query)) {
            if (params.get(key) !== value)
                return false;
        }
        return true;
    }));
    if (specialized)
        return false;
    if (hrefPath === "/admin")
        return pathname === "/admin";
    return pathname === hrefPath || pathname.startsWith(hrefPath + "/");
}
export function AdminSidebarNav({ enableSpreadsheet = false }) {
    const { pathname, search } = useLocation();
    const groups = React.useMemo(() => buildAdminNavGroups(enableSpreadsheet), [enableSpreadsheet]);
    return (_jsx("nav", { className: "admin-nav", "aria-label": "\u7BA1\u7406\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3", children: groups.map((group) => (_jsxs("section", { className: "admin-nav-group", children: [_jsx("h2", { className: "admin-nav-group-title", children: group.title }), group.items.map((item) => {
                    const active = isAdminNavActive(item.href, pathname, search, groups);
                    return (_jsxs(OpsLink, { href: item.href, className: "admin-nav-link" + (active ? " admin-nav-link-active" : ""), "aria-current": active ? "page" : undefined, children: [item.icon, item.label] }, item.href));
                })] }, group.title))) }));
}
/** Exactly CURRENT's Admin branch; the OpsGate must authorize before this renders. */
export function AdminSidebar({ enableSpreadsheet = false }) {
    return (_jsxs("aside", { className: "admin-sidebar", children: [_jsxs("div", { className: "admin-mode-banner", children: [_jsx("span", { className: "admin-mode-badge", children: "ADMIN" }), _jsx("span", { className: "admin-mode-label", children: "\u30B5\u30A4\u30C8\u7BA1\u7406" }), _jsxs("p", { className: "admin-mode-hint", children: ["\u30B5\u30A4\u30C8\u5168\u4F53\u306E\u8A2D\u5B9A\u30FB\u76E3\u67FB\u30FB\u30E6\u30FC\u30B6\u30FC\u7BA1\u7406\u3092\u884C\u3044\u307E\u3059\u3002 \u62C5\u5F53\u30A4\u30D9\u30F3\u30C8\u306E\u73FE\u5834\u904B\u7528\u306F", _jsx("strong", { children: " /manage" }), "\u304B\u3089\u884C\u3063\u3066\u304F\u3060\u3055\u3044\u3002"] })] }), _jsx(AdminSidebarNav, { enableSpreadsheet: enableSpreadsheet })] }));
}
