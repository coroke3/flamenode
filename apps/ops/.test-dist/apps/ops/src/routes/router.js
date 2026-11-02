import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { CostGuardBanner } from "../components/layout/CostGuardBanner.js";
import { AdminLayout } from "./admin/AdminLayout.js";
import { AdminCompatRedirect } from "./admin/AdminRedirects.js";
import { AdminTop } from "./admin/AdminTop.js";
import { PermissionSimulator } from "./admin/PermissionSimulator.js";
import { AuthErrorView, OpsGate } from "./guard.js";
/** MIG-0707 U02: placeholder only. No protected screen data is served until its own MIG is reviewed. */
function UnmigratedView() {
    return _jsx("section", { "aria-label": "\u904B\u55B6\u30B3\u30F3\u30BD\u30FC\u30EB", children: "\u79FB\u884C\u6E96\u5099\u4E2D" });
}
export class OpsRouteErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) { return { error }; }
    render() {
        if (!this.state.error)
            return this.props.children;
        return _jsx(AuthErrorView, { error: this.state.error, reset: () => this.setState({ error: null }) });
    }
}
export function OpsRoutes({ api }) {
    const manage = _jsx(OpsGate, { surface: "manage", api: api, children: _jsx(UnmigratedView, {}) });
    // MIG-0726: header/footer stay injected-null until FIX-0701-1 (D-13-6) gives both SPAs the shared ones.
    const adminFrame = (_jsx(AdminLayout, { api: api, banner: _jsx(CostGuardBanner, { source: "admin" }), header: null, footer: null, children: _jsx(Outlet, {}) }));
    return (_jsx("div", { "data-fn-surface": "ops", className: "fn-app", children: _jsx("main", { className: "fn-main flex-1 w-full", children: _jsx(OpsRouteErrorBoundary, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/manage", element: manage }), _jsx(Route, { path: "/manage/*", element: manage }), _jsxs(Route, { path: "/admin", element: adminFrame, children: [_jsx(Route, { index: true, element: _jsx(AdminTop, {}) }), _jsx(Route, { path: "permissions/simulator", element: _jsx(PermissionSimulator, {}) }), _jsx(Route, { path: "history", element: _jsx(AdminCompatRedirect, {}) }), _jsx(Route, { path: "events/new", element: _jsx(UnmigratedView, {}) }), _jsx(Route, { path: "events/templates", element: _jsx(UnmigratedView, {}) }), _jsx(Route, { path: "events/:id", element: _jsx(AdminCompatRedirect, {}) }), _jsx(Route, { path: "events/:id/edit", element: _jsx(AdminCompatRedirect, {}) }), _jsx(Route, { path: "events/:id/slots", element: _jsx(AdminCompatRedirect, {}) }), _jsx(Route, { path: "events/:id/staff", element: _jsx(AdminCompatRedirect, {}) }), _jsx(Route, { path: "*", element: _jsx(UnmigratedView, {}) })] })] }) }) }) }));
}
