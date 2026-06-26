import type { IconName } from "@/components/ui/Icon";

/** 公開面ヘッダー共通ナビ（PublicHeader） */
export const PUBLIC_NAV_ITEMS: {
  href: string;
  label: string;
  iconName: IconName;
}[] = [
  { href: "/list", label: "作品", iconName: "grid" },
  { href: "/event", label: "イベント", iconName: "calendar" },
  { href: "/user", label: "クリエイター", iconName: "users" },
  { href: "/entry", label: "参加・投稿", iconName: "edit" },
];
