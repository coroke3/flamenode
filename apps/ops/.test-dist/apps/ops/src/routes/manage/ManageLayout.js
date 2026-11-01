import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { loadManageNavigation } from "../../api/manageNavigation.js";
import { useApiResult } from "../useApiResult.js";
import { ConsoleShell } from "../../components/shared/ConsoleShell.js";
import { CostGuardBanner } from "../../components/layout/CostGuardBanner.js";
import { ManageSidebarNav } from "./ManageSidebarNav.js";
import { shouldWarnManageActiveXMismatch } from "./ManageActiveXNotice.js";
import { AUTH_UNAVAILABLE } from "../guard.js";
export function decideManageNavigation(result) {
    if (result.status === "ok")
        return null;
    if (result.status === "anonymous")
        return "/entry";
    if (result.status === "forbidden" && result.reason === "manage_access_required")
        return "/dashboard";
    if (result.status === "loading")
        return null;
    return AUTH_UNAVAILABLE;
}
export function shouldRenderManageSidebar(data) {
    return data.access.isAdmin || data.events.length > 0 || data.access.canManageXIdLinkRequests;
}
export function ManageLayout({ children, fetchFn = fetch }) {
    const result = useApiResult(signal => loadManageNavigation(fetchFn, signal), "manage-navigation");
    const redirect = decideManageNavigation(result);
    React.useEffect(() => { if (redirect)
        window.location.assign(redirect); }, [redirect]);
    if (result.status !== "ok")
        return _jsx("div", { role: "status", "aria-busy": "true", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." });
    const data = result.data;
    const sidebar = shouldRenderManageSidebar(data) ? _jsxs("aside", { className: "admin-sidebar", children: [_jsxs("div", { className: "manage-mode-banner", children: [_jsx("span", { className: "manage-mode-badge", children: "MANAGE" }), _jsx("span", { className: "manage-mode-label", children: "\u30A4\u30D9\u30F3\u30C8\u904B\u55B6" }), _jsxs("p", { className: "manage-mode-hint", children: ["\u62C5\u5F53\u30A4\u30D9\u30F3\u30C8\u306E\u5BE9\u67FB\u30FB\u67A0\u30FB\u901A\u77E5\u3092\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002\u30B5\u30A4\u30C8\u5168\u4F53\u306E\u7BA1\u7406\u306F\u7BA1\u7406\u8005\u306E\u307F ", _jsx("strong", { children: "/admin" }), " \u3067\u884C\u3044\u307E\u3059\u3002"] })] }), _jsx(ManageSidebarNav, { events: data.events, showXLinkRequests: data.access.canManageXIdLinkRequests, warnActiveX: !data.access.isAdmin && shouldWarnManageActiveXMismatch(data.activeXUserId, data.manageStaffXUserIds), activeX: data.activeXUserId })] }) : null;
    return _jsxs("div", { "data-manage-shell": true, "data-fn-surface": "manage", children: [_jsx(CostGuardBanner, { fetchFn: fetchFn }), _jsx(ConsoleShell, { consoleMode: "manage", navigation: sidebar, children: _jsx("main", { className: "manage-main", children: children }) })] });
}
