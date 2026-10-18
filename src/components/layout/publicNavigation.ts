/**
 * Legacy bridge: the navigation data lives in packages/ui (MIG-0203).
 * The annotation below makes tsc reject a packages/ui icon name that CURRENT `Icon` cannot draw.
 */
import {
  PUBLIC_NAV_ITEMS as UI_PUBLIC_NAV_ITEMS,
  isPublicNavItemActive,
  type PublicNavItem,
  type PublicNavIconName,
} from "@flamenode/ui/navigation/publicNavigation.ts";
import type { IconName } from "@/components/ui/Icon";

export type { PublicNavItem, PublicNavIconName };

export const PUBLIC_NAV_ITEMS: readonly {
  readonly href: string;
  readonly label: string;
  readonly iconName: IconName;
}[] = UI_PUBLIC_NAV_ITEMS;

export { isPublicNavItemActive };
