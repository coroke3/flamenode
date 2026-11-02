import { jsx as _jsx } from "react/jsx-runtime";
// Port of CURRENT src/components/admin/AdminSectionTabs.tsx (MIG-0707 U05, D-17-6). Same output.
import { useLocation } from "react-router-dom";
import { AdminResourceTabs } from "./AdminResourceTabs.js";
const HUB_TABS = {
    audit: [
        { key: "/admin/audit", href: "/admin/audit", label: "監査ログ", icon: "clock" },
        { key: "/admin/audit/settings", href: "/admin/audit/settings", label: "ログ設定", icon: "settings" },
        { key: "/admin/audit/restore", href: "/admin/audit/restore", label: "復元履歴", icon: "refresh" },
    ],
    health: [
        { key: "/admin/health", href: "/admin/health", label: "ヘルスチェック", icon: "check" },
        { key: "/admin/health/integrity", href: "/admin/health/integrity", label: "DB整合性", icon: "list" },
        { key: "/admin/workers", href: "/admin/workers", label: "Worker監視", icon: "clock" },
    ],
    events: [
        { key: "/admin/events", href: "/admin/events", label: "イベント一覧", icon: "calendar" },
        { key: "/admin/event-groups", href: "/admin/event-groups", label: "グループ", icon: "users" },
        { key: "/admin/events/templates", href: "/admin/events/templates", label: "テンプレート", icon: "copy" },
    ],
};
const HUB_ARIA_LABELS = {
    audit: "監査メニュー",
    health: "診断メニュー",
    events: "イベント管理メニュー",
};
export function AdminSectionTabs({ hub }) {
    return (_jsx(AdminResourceTabs, { tabs: HUB_TABS[hub], active: useLocation().pathname, ariaLabel: HUB_ARIA_LABELS[hub], className: "sectabs-tabs" }));
}
