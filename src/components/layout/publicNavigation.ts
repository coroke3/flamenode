import type { IconName } from "@/components/ui/Icon";

/**
 * PublicHeaderのデスクトップ/モバイル両方で使う公開ナビゲーション。
 * 表示順とラベルを1か所に置き、ブレークポイントごとのメニュー差分を防ぐ。
 */
export const PUBLIC_NAV_ITEMS = [
  { href: "/list", label: "動画", iconName: "grid" },
  { href: "/user", label: "クリエイター", iconName: "users" },
  { href: "/event", label: "イベント", iconName: "calendar" },
] as const satisfies readonly {
  href: string;
  label: string;
  iconName: IconName;
}[];

export function isPublicNavItemActive(
  pathname: string | null,
  href: string,
): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
