import "server-only";

import { Icon } from "@/components/ui/Icon";
import type { AdminSidebarGroup } from "@/components/admin/AdminSidebarNav";

function isAdminSpreadsheetNavEnabled(): boolean {
  const v = process.env.ADMIN_SPREADSHEET_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const ADMIN_NAV_SPREADSHEET_ITEM = {
  href: "/admin/spreadsheet",
  label: "DBスプレッドシート",
  icon: <Icon name="grid" size={14} />,
} as const;

const ADMIN_NAV_GROUPS_BASE: AdminSidebarGroup[] = [
  {
    title: "概要",
    items: [
      { href: "/admin", label: "ダッシュボード", icon: <Icon name="grid" size={14} /> },
    ],
  },
  {
    title: "審査・申請",
    items: [
      {
        href: "/admin/videos?status=pending",
        label: "承認待ち作品",
        icon: <Icon name="youtube" size={14} />,
      },
      {
        href: "/admin/x-link-requests",
        label: "X ID申請",
        icon: <Icon name="user" size={14} />,
      },
      {
        href: "/admin/moderation",
        label: "モデレーション",
        icon: <Icon name="warning" size={14} />,
      },
    ],
  },
  {
    title: "コンテンツ",
    items: [
      { href: "/admin/videos", label: "作品管理", icon: <Icon name="youtube" size={14} /> },
      {
        href: "/admin/youtube-sync",
        label: "YouTube同期",
        icon: <Icon name="refresh" size={14} />,
      },
      {
        href: "/admin/announcements",
        label: "お知らせ",
        icon: <Icon name="alert" size={14} />,
      },
    ],
  },
  {
    title: "イベント",
    items: [
      { href: "/admin/events", label: "イベント管理", icon: <Icon name="calendar" size={14} /> },
      {
        href: "/admin/event-groups",
        label: "イベントグループ",
        icon: <Icon name="list" size={14} />,
      },
    ],
  },
  {
    title: "ユーザー・権限",
    items: [
      { href: "/admin/users", label: "ユーザー / X ID", icon: <Icon name="users" size={14} /> },
      {
        href: "/admin/permissions/simulator",
        label: "権限シミュレーター",
        icon: <Icon name="user" size={14} />,
      },
    ],
  },
  {
    title: "システム",
    items: [
      {
        href: "/admin/notifications",
        label: "通知配信",
        icon: <Icon name="alert" size={14} />,
      },
      { href: "/admin/rules", label: "規約管理", icon: <Icon name="info" size={14} /> },
      { href: "/admin/audit", label: "監査ログ", icon: <Icon name="clock" size={14} /> },
      {
        href: "/admin/cost-guard",
        label: "operation_mode",
        icon: <Icon name="warning" size={14} />,
      },
      {
        href: "/admin/static-builds",
        label: "静的JSON再生成",
        icon: <Icon name="refresh" size={14} />,
      },
      {
        href: "/admin/workers",
        label: "Worker監視",
        icon: <Icon name="clock" size={14} />,
      },
      {
        href: "/admin/youtube-quota",
        label: "YouTube quota",
        icon: <Icon name="youtube" size={14} />,
      },
      { href: "/admin/health", label: "ヘルスチェック", icon: <Icon name="check" size={14} /> },
    ],
  },
  {
    title: "高度な管理",
    items: [
      { href: "/admin/security", label: "セキュリティ", icon: <Icon name="settings" size={14} /> },
      {
        href: "/admin/api-endpoints",
        label: "公開API管理",
        icon: <Icon name="external" size={14} />,
      },
      {
        href: "/admin/import",
        label: "旧形式インポート",
        icon: <Icon name="upload" size={14} />,
      },
    ],
  },
];

export function buildAdminNavGroups(): AdminSidebarGroup[] {
  let groups = ADMIN_NAV_GROUPS_BASE;

  if (isAdminSpreadsheetNavEnabled()) {
    groups = groups.map((group) =>
      group.title === "高度な管理"
        ? {
            ...group,
            items: [...group.items, ADMIN_NAV_SPREADSHEET_ITEM],
          }
        : group,
    );
  }

  return groups;
}
