import * as React from "react";
import { Link } from "react-router-dom";

/** Paths served by this SPA. Everything else (/entry, /dashboard/edit/*, /rules, public pages) is another app. */
const SPA_PATHS = new Set(["/dashboard", "/dashboard/library", "/dashboard/settings", "/onboarding"]);

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

/**
 * next/link equivalent: in-SPA targets use client navigation (history/back-forward keep working),
 * other targets are full navigations, as they are served by another app/Worker.
 */
export function AppLink({ href, ...rest }: AnchorProps): React.ReactElement {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  if (SPA_PATHS.has(path)) return <Link to={href} {...rest} />;
  return <a href={href} {...rest} />;
}

/** Full-navigation seam (jsdom cannot observe `location.replace`, so tests replace `navigation.replace`). */
export const navigation = {
  replace: (to: string): void => window.location.replace(to),
};

/** Leaves this SPA with a full navigation (admin SPA, /rules). */
export function ExternalRedirect({ to }: { to: string }): null {
  React.useEffect(() => {
    navigation.replace(to);
  }, [to]);
  return null;
}

/** CURRENT metadata.title with the `%s | FlameNode` template. */
export function useDocumentTitle(title: string): void {
  React.useEffect(() => {
    document.title = `${title} | FlameNode`;
  }, [title]);
}
