import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { Route, Routes } from "react-router-dom";
import { AuthErrorView, OpsGate } from "./guard.js";
import { ManageLayout } from "./manage/ManageLayout.js";
import { ManageDashboard } from "./manage/ManageDashboard.js";
import { ManageReviewRedirect } from "./manage/ManageReviewRedirect.js";
/** Future MIG-0720..0725 and MIG-0726 admin screens retain an explicit placeholder. */
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
    return _jsx("div", { "data-fn-surface": "ops", className: "fn-app", children: _jsx("div", { className: "fn-main flex-1 w-full", children: _jsx(OpsRouteErrorBoundary, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/manage/*", element: _jsx(OpsGate, { surface: "manage", api: api, children: _jsx(ManageLayout, { children: _jsxs(Routes, { children: [_jsx(Route, { index: true, element: _jsx(ManageDashboard, {}) }), _jsx(Route, { path: "events/:id/review", element: _jsx(ManageReviewRedirect, {}) }), _jsx(Route, { path: "*", element: _jsx(UnmigratedView, {}) })] }) }) }) }), _jsx(Route, { path: "/admin", element: _jsx(OpsGate, { surface: "admin", api: api, children: _jsx(UnmigratedView, {}) }) }), _jsx(Route, { path: "/admin/*", element: _jsx(OpsGate, { surface: "admin", api: api, children: _jsx(UnmigratedView, {}) }) })] }) }) }) });
}
