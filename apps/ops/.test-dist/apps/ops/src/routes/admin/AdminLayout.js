import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ConsoleShell } from "../../components/shared/ConsoleShell.js";
import { OpsGate } from "../guard.js";
import { AdminSidebar } from "./AdminSidebarNav.js";
/**
 * Admin parity shell. The caller supplies shared header/footer and the admin
 * cost banner; MIG-0719 owns their shared implementation and MIG-0661 its DTO.
 * Never render this frame outside OpsGate: no client gate replaces API authz.
 */
export function AdminLayoutFrame({ children, banner, header, footer, enableSpreadsheet = false, }) {
    return (_jsxs("div", { "data-admin-shell": "", "data-fn-surface": "admin", children: [banner, header, _jsx(ConsoleShell, { consoleMode: "admin", navigation: _jsx(AdminSidebar, { enableSpreadsheet: enableSpreadsheet }), children: _jsx("main", { className: "admin-main", children: children }) }), footer] }));
}
/** No Admin UI content is mounted until a fresh admin-only RH-001 gate allows it. */
export function AdminLayout({ api, children, banner, header, footer, enableSpreadsheet = false, }) {
    return (_jsx(OpsGate, { surface: "admin", api: api, children: _jsx(AdminLayoutFrame, { banner: banner, header: header, footer: footer, enableSpreadsheet: enableSpreadsheet, children: children }) }));
}
