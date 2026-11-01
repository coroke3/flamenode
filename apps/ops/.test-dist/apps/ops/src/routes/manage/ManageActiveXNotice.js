import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
export function shouldWarnManageActiveXMismatch(activeX, staffXIds) {
    const id = activeX?.trim();
    return Boolean(id && staffXIds.length > 0 && !staffXIds.includes(id));
}
export function ManageActiveXNotice({ activeXUserId, manageStaffXUserIds }) {
    if (!shouldWarnManageActiveXMismatch(activeXUserId, manageStaffXUserIds))
        return null;
    return _jsxs("div", { role: "status", className: "manage-active-x-notice", children: [_jsx("strong", { children: "Active X ID \u3068\u904B\u55B6\u6A29\u9650\u306E X ID \u304C\u4E00\u81F4\u3057\u3066\u3044\u307E\u305B\u3093" }), _jsxs("p", { children: ["\u904B\u55B6\u753B\u9762\u3078\u306E\u5165\u5834\u30FB\u5BE9\u67FB\u306F\u627F\u8A8D\u6E08\u307F X ID \u5168\u4F53\u3067\u5224\u5B9A\u3055\u308C\u307E\u3059\uFF08\u73FE\u5728\u306E Active X: @", activeXUserId?.trim(), "\uFF09\u3002\u6295\u7A3F\u3084\u67A0\u78BA\u4FDD\u306E\u4E3B\u4F53\u3092\u5909\u3048\u308B\u5834\u5408\u306F", " ", _jsx(Link, { href: "/dashboard/settings", children: "\u8A2D\u5B9A" }), " \u3067 Active X \u3092\u5207\u308A\u66FF\u3048\u3066\u304F\u3060\u3055\u3044\u3002"] })] });
}
