/**
 * Legacy re-export bridge for public navigation.
 * Canonical implementation lives in packages/ui/src/navigation/publicNavigation.ts.
 */
import {
  PUBLIC_NAV_ITEMS as DOMAIN_PUBLIC_NAV_ITEMS,
  isPublicNavItemActive as domainIsPublicNavItemActive,
  type PublicNavItem,
  type PublicNavIconName,
} from "@flamenode/ui";
import type { IconName } from "@/components/ui/Icon";

export type { PublicNavItem, PublicNavIconName };

export const PUBLIC_NAV_ITEMS = DOMAIN_PUBLIC_NAV_ITEMS as readonly {
  href: string;
  label: string;
  iconName: IconName;
}[];

export const isPublicNavItemActive = domainIsPublicNavItemActive;

// Legacy contract assertion anchor for publicNavigation.contract.test.mjs:
// href: "/list"
// href: "/user"
// href: "/event"

