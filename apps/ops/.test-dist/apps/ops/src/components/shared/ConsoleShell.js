import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ConsoleDrawer } from "./ConsoleDrawer.js";
/**
 * /admin・/manage 共通の 2 カラムシェル (左ナビ固定幅 + メイン)。
 */
export function ConsoleShell({ consoleMode, navigation, children, }) {
    const isAdmin = consoleMode === "admin";
    const label = isAdmin ? "管理メニュー" : "運営メニュー";
    return (_jsx("div", { className: isAdmin ? "admin-shell" : "manage-shell", "data-console-mode": consoleMode, children: _jsxs("div", { className: isAdmin ? "admin-frame" : "fn-console-frame", children: [_jsx(ConsoleDrawer, { label: label, modeLabel: isAdmin ? "サイト管理" : "イベント運営", children: navigation }), children] }) }));
}
