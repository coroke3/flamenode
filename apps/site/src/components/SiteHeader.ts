import React from "react";
import { PublicHeader } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import { ThemeToggle } from "./ThemeToggle.ts";
import { AccountSlot, MobileAccountSlot } from "./AccountMenu.ts";
import { switchActiveX } from "../lib/activeX.ts";
import { ACTIVE_X_CHANGED_EVENT } from "../../../../src/lib/client/activeXSwitchEvents.ts";

export interface SiteHeaderProps {
  currentPath?: string;
}

/**
 * The shared public header as one hydrated Island (MIG-0203 header, MIG-0402 wrapper). It is the only
 * script on a fixed page: the mobile menu and the search toggle need it, the rest of the page is static.
 * Theme switch (MIG-0507 U06) and the account menu (U08, RH-001) are mounted inside it.
 */
export function SiteHeader({ currentPath }: SiteHeaderProps): React.ReactElement {
  // CURRENT router.refresh() equivalent: after a successful switch event, reload the
  // Astro page to refresh all server-rendered account-sensitive data.
  React.useEffect(() => {
    const reloadAfterSwitch = () => window.location.reload();
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, reloadAfterSwitch);
    return () => window.removeEventListener(ACTIVE_X_CHANGED_EVENT, reloadAfterSwitch);
  }, []);

  return React.createElement(
    IslandWrapper,
    null,
    React.createElement(PublicHeader, { currentPath, themeToggle: React.createElement(ThemeToggle),
      account: React.createElement(AccountSlot, { currentPath, switchActiveX }),
      mobileAccount: React.createElement(MobileAccountSlot, { currentPath }),
    }),
  );
}

export default SiteHeader;
