import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// MIG-0726 U03: port of CURRENT permissions/simulator/page.tsx + PermissionSimulatorPanel.tsx (SA-xxx).
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { adminReadRedirect, fetchPermissionSimulator, normalizeSimulatorQuery, } from "../../api/adminTop.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { useApiResult } from "../useApiResult.js";
/** Pure panel (CURRENT PermissionSimulatorPanel). The GET form keeps full-page navigation semantics. */
export function PermissionSimulatorPanel({ eventId, xUserId, result }) {
    return (_jsxs("div", { style: { display: "grid", gap: 20 }, children: [_jsxs("form", { method: "get", className: "fn-form-grid", style: { maxWidth: 640 }, children: [_jsxs("label", { className: "fn-label", children: ["\u30A4\u30D9\u30F3\u30C8 ID", _jsx("input", { name: "event_id", className: "fn-input", defaultValue: eventId, placeholder: "evt_...", required: true })] }), _jsxs("label", { className: "fn-label", children: ["X ID", _jsx("input", { name: "x_user_id", className: "fn-input", defaultValue: xUserId, placeholder: "@screen_name", required: true })] }), _jsx("button", { type: "submit", className: "fn-btn fn-btn-primary", children: "\u6A29\u9650\u3092\u30B7\u30DF\u30E5\u30EC\u30FC\u30C8" })] }), _jsx("p", { className: "fn-muted fn-text-sm", style: { margin: 0 }, children: "X ID\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u30A4\u30D9\u30F3\u30C8\u30B9\u30BF\u30C3\u30D5\u767B\u9332\u306E\u6B63\u672C\u3092\u53C2\u7167\u3057\u307E\u3059\u3002" }), !result ? (_jsx("p", { className: "fn-muted", children: "\u6761\u4EF6\u3092\u5165\u529B\u3057\u3066\u30B7\u30DF\u30E5\u30EC\u30FC\u30C8\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })) : !result.found ? (_jsxs("p", { role: "status", className: "fn-muted", children: ["\u8A72\u5F53\u3059\u308B\u30B9\u30BF\u30C3\u30D5\u884C\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\uFF08event: ", _jsx("code", { children: result.eventId }), "\uFF09\u3002"] })) : (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("section", { className: "fn-card", children: [_jsx("h2", { style: { fontSize: 15, fontWeight: 700, marginBottom: 10 }, children: "\u30B9\u30BF\u30C3\u30D5\u60C5\u5831" }), _jsxs("dl", { className: "admin-permission-result-grid", style: { display: "grid", gridTemplateColumns: "minmax(120px, auto) 1fr", gap: "6px 12px", fontSize: 13 }, children: [_jsx("dt", { className: "fn-muted", children: "\u8868\u793A\u540D" }), _jsx("dd", { style: { margin: 0 }, children: result.displayName ?? "—" }), _jsx("dt", { className: "fn-muted", children: "\u30D7\u30EA\u30BB\u30C3\u30C8" }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx("span", { className: "fn-badge fn-badge-soft", children: result.presetLabel }), " ", _jsx("code", { children: result.preset })] }), _jsx("dt", { className: "fn-muted", children: "X ID" }), _jsx("dd", { style: { margin: 0 }, children: result.xUserId ? `@${result.xUserId}` : "—" })] }), _jsx("p", { style: { marginTop: 12 }, children: _jsx(Link, { href: `/manage/events/${encodeURIComponent(result.eventId)}/staff`, className: "fn-btn fn-btn-ghost fn-btn-sm", children: "\u30B9\u30BF\u30C3\u30D5\u7BA1\u7406\u3078" }) })] }), _jsxs("section", { className: "fn-card", children: [_jsx("h2", { style: { fontSize: 15, fontWeight: 700, marginBottom: 10 }, children: "\u4E3B\u8981\u6A29\u9650" }), _jsxs("table", { className: "fn-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u6A29\u9650" }), _jsx("th", { children: "\u53EF\u5426" })] }) }), _jsx("tbody", { children: result.spotlight.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: item.label }), _jsx("td", { children: item.allowed
                                                        ? _jsx("span", { className: "fn-badge fn-badge-accent", children: "\u53EF" })
                                                        : _jsx("span", { className: "fn-badge fn-badge-soft", children: "\u4E0D\u53EF" }) })] }, item.key))) })] })] }), _jsxs("section", { className: "fn-card", children: [_jsxs("h2", { style: { fontSize: 15, fontWeight: 700, marginBottom: 10 }, children: ["\u89E3\u6C7A\u6E08\u307F\u6A29\u9650\u4E00\u89A7\uFF08", result.resolvedKeys.length, "\uFF09"] }), result.resolvedKeys.length === 0 ? (_jsx("p", { className: "fn-muted fn-text-sm", children: "\u6A29\u9650\u30AD\u30FC\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("ul", { style: { margin: 0, paddingLeft: 18, fontSize: 13 }, children: result.resolvedLabels.map((label) => _jsx("li", { children: label }, label)) }))] })] }))] }));
}
/** Page shell shared by the loaded and empty states (CURRENT page.tsx). */
export function PermissionSimulatorPage({ eventId, xUserId, result }) {
    return (_jsxs("div", { children: [_jsx(ConsolePageHeader, { title: "\u6A29\u9650\u30B7\u30DF\u30E5\u30EC\u30FC\u30BF\u30FC", description: "\u30A4\u30D9\u30F3\u30C8\u30B9\u30BF\u30C3\u30D5\u306E\u30D7\u30EA\u30BB\u30C3\u30C8\u3068\u30AB\u30B9\u30BF\u30E0\u6A29\u9650\u3092X ID\u304B\u3089\u78BA\u8A8D\u3057\u307E\u3059\u3002" }), _jsx(PermissionSimulatorPanel, { eventId: eventId, xUserId: xUserId, result: result })] }));
}
const defaultFetch = (input, init) => fetch(input, init);
export function PermissionSimulator({ fetchFn = defaultFetch }) {
    const [params] = useSearchParams();
    const query = normalizeSimulatorQuery(params);
    const state = useApiResult((signal) => fetchPermissionSimulator(fetchFn, query, signal), "simulator:" + query.eventId + "\u0000" + query.xUserId);
    const redirect = state.status === "loading" ? null : adminReadRedirect(state);
    React.useEffect(() => {
        if (redirect)
            window.location.assign(redirect);
    }, [redirect]);
    if (state.status === "loading" || state.status === "anonymous" || state.status === "forbidden") {
        return _jsx("div", { role: "status", "aria-busy": "true", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." });
    }
    if (state.status !== "ok") {
        return (_jsx("div", { role: "alert", className: "fn-public-container fn-page", children: "\u6A29\u9650\u30B7\u30DF\u30E5\u30EC\u30FC\u30BF\u30FC\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }));
    }
    return _jsx(PermissionSimulatorPage, { eventId: query.eventId, xUserId: query.xUserId, result: state.data.result });
}
