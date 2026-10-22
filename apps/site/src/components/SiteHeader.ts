import React from "react";
import { PublicHeader } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import { ThemeToggle } from "./ThemeToggle.ts";

export interface SiteHeaderProps {
  currentPath?: string;
}

/**
 * The shared public header as one hydrated Island (MIG-0203 header, MIG-0402 wrapper). It is the only
 * script on a fixed page: the mobile menu and the search toggle need it, the rest of the page is static.
 * Theme switch and account menu are separate Islands (MIG-0507 / MIG-0605) and are not passed yet.
 */
export function SiteHeader({ currentPath }: SiteHeaderProps): React.ReactElement {
  return React.createElement(
    IslandWrapper,
    null,
    React.createElement(PublicHeader, { currentPath, themeToggle: React.createElement(ThemeToggle) }),
  );
}

export default SiteHeader;
