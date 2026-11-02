import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as React from "react";
export const AUTH_UNAVAILABLE = "/entry?error=auth_temporarily_unavailable";
/** CURRENT app/(manage|admin)/layout.tsx decision order, plus D-17-14. */
export function decideOpsAccess(surface, result) {
    if (result.status === "unavailable")
        return AUTH_UNAVAILABLE;
    if (result.status === "anonymous")
        return "/entry";
    const summary = result.summary;
    if (summary.degraded === true) {
        // An unknown / absent reason is never interpreted as successful authorization.
        if (summary.degradedReason !== "pending_requests_unavailable")
            return AUTH_UNAVAILABLE;
        if (surface === "admin")
            return summary.role === "admin" ? "allow" : "/dashboard";
        if (summary.role === "admin")
            return "allow";
        // Pending-request query failure does not mean manage permission failure.
        // Recheck using MIG-0624's independently authorized navigation endpoint.
        return "check-navigation";
    }
    if (surface === "admin")
        return summary.role === "admin" ? "allow" : "/dashboard";
    return summary.canAccessAdmin || summary.canAccessManage ? "allow" : "/dashboard";
}
export function decideNavigation(result) {
    switch (result) {
        case "allow": return "allow";
        case "anonymous": return "/entry";
        case "deny": return "/dashboard";
        default: return AUTH_UNAVAILABLE;
    }
}
/** Same wording as CURRENT error boundary (app/(auth)/error.tsx). */
export function AuthErrorView({ error, reset }) {
    const shortTrace = (error?.digest ?? "unknown").slice(0, 12);
    return (_jsxs("div", { className: "fn-public-container fn-page", children: [_jsxs("header", { className: "fn-page-head", children: [_jsx("span", { className: "fn-eyebrow", children: "error" }), _jsx("h1", { className: "fn-display fn-page-title", children: "\u753B\u9762\u306E\u8868\u793A\u4E2D\u306B\u554F\u984C\u304C\u767A\u751F\u3057\u307E\u3057\u305F" })] }), _jsx("section", { className: "fn-entry-status fn-entry-status--warn", role: "alert", children: _jsxs("div", { children: [_jsx("p", { className: "fn-jp fn-entry-status-lead", children: "\u8868\u793A\u524D\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u305F\u304B\u3001\u4FDD\u5B58\u5F8C\u306E\u753B\u9762\u63CF\u753B\u3067\u5931\u6557\u3057\u305F\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002 \u518D\u9001\u3057\u3066\u3082\u5B89\u5168\u306A\u64CD\u4F5C\u3082\u3042\u308A\u307E\u3059\u3002\u307E\u305A\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }), _jsxs("p", { className: "fn-mono fn-text-muted-sm", children: ["trace: ", shortTrace] }), _jsxs("div", { className: "fn-panel-actions", style: { marginTop: 12 }, children: [_jsx("button", { type: "button", className: "fn-btn fn-btn-primary", onClick: reset, children: "\u518D\u8AAD\u307F\u8FBC\u307F" }), _jsx("a", { href: "/entry", className: "fn-btn", children: "\u30ED\u30B0\u30A4\u30F3\u753B\u9762" }), _jsx("a", { href: "/onboarding", className: "fn-btn", children: "\u30AA\u30F3\u30DC\u30FC\u30C7\u30A3\u30F3\u30B0" })] })] }) })] }));
}
export function OpsGate({ surface, api, children }) {
    // Bind the grant to both route surface and API instance. React may reuse this
    // component when switching /manage -> /admin before the new effect runs.
    const [grant, setGrant] = React.useState(null);
    React.useEffect(() => {
        const controller = new AbortController();
        setGrant(null);
        async function resolve() {
            let decision = decideOpsAccess(surface, await api.getSummary(controller.signal));
            if (controller.signal.aborted)
                return;
            if (decision === "check-navigation") {
                decision = decideNavigation(await api.checkManageNavigation(controller.signal));
            }
            if (controller.signal.aborted)
                return;
            if (decision === "allow")
                setGrant({ surface, api });
            else
                window.location.assign(decision);
        }
        void resolve().catch(() => {
            if (!controller.signal.aborted)
                window.location.assign(AUTH_UNAVAILABLE);
        });
        return () => controller.abort();
    }, [api, surface]);
    if (grant?.surface !== surface || grant.api !== api) {
        return _jsx("div", { role: "status", "aria-busy": "true", className: "fn-public-container fn-page", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." });
    }
    return _jsx(_Fragment, { children: children });
}
