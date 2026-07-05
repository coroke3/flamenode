import "server-only";

import * as React from "react";
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
    title: "対応待ち",
    items: [
      {
        href: "/admin/videos?status=pending",
        label: "承認待ち作品",
        icon: <Icon name="youtube" size={14} />,
      },
      {
        href: "/admin/x-link-requests",
        label: "X ID連携申請",
        icon: <Icon name="user" size={14} />,
      },
      {
        href: "/admin/x-id-merges",
        label: "X ID統合申請",
        icon: <Icon name="users" size={14} />,
      },
      {
        href: "/admin/moderation?status=open",
        label: "モデレーション",
        icon: <Icon name="warning" size={14} />,
      },
      {
        href: "/admin/notifications?status=failed",
        label: "通知失敗",
        icon: <Icon name="alert" size={14} />,
      },
    ],
  },
  {
    title: "コンテンツ",
    items: [
      { href: "/admin/videos", label: "作品管理", icon: <Icon name="youtube" size={14} /> },
      {
        href: "/admin/youtube-sync",
        label: "YouTube同期状態",
        icon: <Icon name="refresh" size={14} />,
      },
      { href: "/admin/events", label: "全イベント管理", icon: <Icon name="calendar" size={14} /> },
      {
        href: "/admin/event-groups",
        label: "イベントグループ",
        icon: <Icon name="users" size={14} />,
      },
      {
        href: "/admin/events/templates",
        label: "イベントテンプレート",
        icon: <Icon name="copy" size={14} />,
      },
      {
        href: "/admin/announcements",
        label: "お知らせ管理",
        icon: <Icon name="alert" size={14} />,
      },
    ],
  },
  {
    title: "ユーザー・権限",
    items: [
      { href: "/admin/users", label: "ユーザー / X ID", icon: <Icon name="users" size={14} /> },
      {
        href: "/admin/users?view=permissions",
        label: "権限管理",
        icon: <Icon name="settings" size={14} />,
      },
      {
        href: "/admin/permissions/simulator",
        label: "権限シミュレーター",
        icon: <Icon name="user" size={14} />,
      },
      {
        href: "/admin/users?status=can_create_events",
        label: "開催権限",
        icon: <Icon name="calendar" size={14} />,
      },
    ],
  },
  {
    title: "システム",
    items: [
      { href: "/admin/rules", label: "規約管理", icon: <Icon name="info" size={14} /> },
      { href: "/admin/audit", label: "監査ログ", icon: <Icon name="clock" size={14} /> },
      {
        href: "/admin/audit/settings",
        label: "ログ設定",
        icon: <Icon name="settings" size={14} />,
      },
      {
        href: "/admin/audit/restore",
        label: "復元履歴",
        icon: <Icon name="refresh" size={14} />,
      },
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
      { href: "/admin/health", label: "ヘルスチェック", icon: <Icon name="check" size={14} /> },
      {
        href: "/admin/health/integrity",
        label: "DB整合性チェック",
        icon: <Icon name="list" size={14} />,
      },
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
    ],
  },
];

export function buildAdminNavGroups(): AdminSidebarGroup[] {
  if (!isAdminSpreadsheetNavEnabled()) {
    return ADMIN_NAV_GROUPS_BASE;
  }
  return ADMIN_NAV_GROUPS_BASE.map((group) =>
    group.title === "高度な管理"
      ? {
          ...group,
          items: [...group.items, ADMIN_NAV_SPREADSHEET_ITEM],
        }
      : group,
  );
}
