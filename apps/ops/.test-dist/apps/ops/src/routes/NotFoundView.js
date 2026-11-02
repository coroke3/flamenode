import { jsx as _jsx } from "react/jsx-runtime";
import { EmptyState } from "../components/shared/EmptyState.js";
/** MIG-0707 U05c: render the exact CURRENT 404 EmptyState through the shared port. */
export function NotFoundView() {
    return (_jsx("div", { className: "fn-public-container fn-page", style: { paddingBlock: "48px 64px" }, children: _jsx(EmptyState, { title: "\u30DA\u30FC\u30B8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093", description: "URL \u3092\u78BA\u8A8D\u3059\u308B\u304B\u3001\u30C8\u30C3\u30D7\u30DA\u30FC\u30B8\u304B\u3089\u518D\u5EA6\u304A\u63A2\u3057\u304F\u3060\u3055\u3044\u3002", iconName: "info", tone: "neutral", actions: [{ href: "/", label: "トップへ戻る", variant: "primary" }] }) }));
}
