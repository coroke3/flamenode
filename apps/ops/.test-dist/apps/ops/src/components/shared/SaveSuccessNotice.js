import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PublicReflectionDelayNotice } from "./PublicReflectionDelayNotice.js";
export function SaveSuccessNotice({ message, pendingPublicReflection, className, style, }) {
    return (_jsxs("div", { role: "status", className: className ?? "fn-success", style: style, children: [_jsx("div", { children: message }), pendingPublicReflection ? (_jsx("div", { style: { marginTop: 8 }, children: _jsx(PublicReflectionDelayNotice, {}) })) : null] }));
}
