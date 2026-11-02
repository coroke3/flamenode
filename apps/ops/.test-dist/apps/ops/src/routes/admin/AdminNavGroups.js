import { jsx as _jsx } from "react/jsx-runtime";
import { Icon } from "../../components/shared/Icon.js";
const ADMIN_NAV_SPREADSHEET_ITEM = {
    href: "/admin/spreadsheet",
    label: "DBスプレッドシート",
    icon: _jsx(Icon, { name: "grid", size: 14 }),
};
const ADMIN_NAV_GROUPS_BASE = [
    {
        title: "概要",
        items: [
            { href: "/admin", label: "ダッシュボード", icon: _jsx(Icon, { name: "grid", size: 14 }) },
        ],
    },
    {
        title: "審査・申請",
        items: [
            {
                href: "/admin/videos?status=pending",
                label: "承認待ち作品",
                icon: _jsx(Icon, { name: "youtube", size: 14 }),
            },
            {
                href: "/admin/x-link-requests",
                label: "X ID申請",
                icon: _jsx(Icon, { name: "user", size: 14 }),
            },
            {
                href: "/admin/moderation",
                label: "モデレーション",
                icon: _jsx(Icon, { name: "warning", size: 14 }),
            },
        ],
    },
    {
        title: "コンテンツ",
        items: [
            { href: "/admin/videos", label: "作品管理", icon: _jsx(Icon, { name: "youtube", size: 14 }) },
            {
                href: "/admin/youtube-sync",
                label: "YouTube同期",
                icon: _jsx(Icon, { name: "refresh", size: 14 }),
            },
            {
                href: "/admin/announcements",
                label: "お知らせ",
                icon: _jsx(Icon, { name: "alert", size: 14 }),
            },
        ],
    },
    {
        title: "イベント",
        items: [
            { href: "/admin/events", label: "イベント管理", icon: _jsx(Icon, { name: "calendar", size: 14 }) },
            {
                href: "/admin/event-groups",
                label: "イベントグループ",
                icon: _jsx(Icon, { name: "list", size: 14 }),
            },
        ],
    },
    {
        title: "ユーザー・権限",
        items: [
            { href: "/admin/users", label: "ユーザー / X ID", icon: _jsx(Icon, { name: "users", size: 14 }) },
            {
                href: "/admin/permissions/simulator",
                label: "権限シミュレーター",
                icon: _jsx(Icon, { name: "user", size: 14 }),
            },
        ],
    },
    {
        title: "システム",
        items: [
            {
                href: "/admin/notifications",
                label: "通知配信",
                icon: _jsx(Icon, { name: "alert", size: 14 }),
            },
            { href: "/admin/rules", label: "規約管理", icon: _jsx(Icon, { name: "info", size: 14 }) },
            { href: "/admin/audit", label: "監査ログ", icon: _jsx(Icon, { name: "clock", size: 14 }) },
            {
                href: "/admin/cost-guard",
                label: "operation_mode",
                icon: _jsx(Icon, { name: "warning", size: 14 }),
            },
            {
                href: "/admin/static-builds",
                label: "静的JSON再生成",
                icon: _jsx(Icon, { name: "refresh", size: 14 }),
            },
            {
                href: "/admin/workers",
                label: "Worker監視",
                icon: _jsx(Icon, { name: "clock", size: 14 }),
            },
            {
                href: "/admin/youtube-quota",
                label: "YouTube quota",
                icon: _jsx(Icon, { name: "youtube", size: 14 }),
            },
            { href: "/admin/health", label: "ヘルスチェック", icon: _jsx(Icon, { name: "check", size: 14 }) },
        ],
    },
    {
        title: "高度な管理",
        items: [
            { href: "/admin/security", label: "セキュリティ", icon: _jsx(Icon, { name: "settings", size: 14 }) },
            {
                href: "/admin/api-endpoints",
                label: "公開API管理",
                icon: _jsx(Icon, { name: "external", size: 14 }),
            },
            {
                href: "/admin/import",
                label: "旧形式インポート",
                icon: _jsx(Icon, { name: "upload", size: 14 }),
            },
        ],
    },
];
export function buildAdminNavGroups(enableSpreadsheet = false) {
    let groups = ADMIN_NAV_GROUPS_BASE;
    if (enableSpreadsheet) {
        groups = groups.map((group) => group.title === "高度な管理"
            ? {
                ...group,
                items: [...group.items, ADMIN_NAV_SPREADSHEET_ITEM],
            }
            : group);
    }
    return groups;
}
