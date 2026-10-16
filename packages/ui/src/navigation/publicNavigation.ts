export type PublicNavIconName = "grid" | "users" | "calendar" | string;

export interface PublicNavItem {
  readonly href: string;
  readonly label: string;
  readonly iconName: PublicNavIconName;
}

/**
 * Public header and navigation items shared across desktop and mobile.
 */
export const PUBLIC_NAV_ITEMS = [
  { href: "/list", label: "動画", iconName: "grid" },
  { href: "/user", label: "クリエイター", iconName: "users" },
  { href: "/event", label: "イベント", iconName: "calendar" },
] as const satisfies readonly PublicNavItem[];

/**
 * Returns true if the current pathname matches the item href or is a subpath.
 */
export function isPublicNavItemActive(
  pathname: string | null,
  href: string,
): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
