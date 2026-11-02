import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "./cn.js";
import { TableScroll } from "./TableScroll.js";
/**
 * 管理・運営向けの横スクロール対応テーブル。
 * `fn-table` + `TableScroll` をまとめたラッパ。
 */
export function FnTable({ className, children, ...rest }) {
    return (_jsx(TableScroll, { children: _jsx("table", { className: cn("fn-table", className), ...rest, children: children }) }));
}
