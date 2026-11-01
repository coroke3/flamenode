import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "./cn.js";
export function ConsolePanel({ children, title, tone = "default", separated = false, compact = false, className, }) {
    return (_jsxs("section", { className: cn("fn-console-panel", separated && "fn-console-panel--separated", compact && "fn-console-panel--compact", tone === "danger" && "fn-console-panel--danger", className), children: [title ? _jsx("h2", { className: "fn-console-panel-title", children: title }) : null, children] }));
}
