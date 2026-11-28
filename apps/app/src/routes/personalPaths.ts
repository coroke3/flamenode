/** Single source of truth for routes currently mounted in PersonalRoutes.
 * Keep this table in sync when MIG-0715/0716/0717 routes are actually mounted.
 * A deep link that is not mounted here belongs to another app/Worker.
 */
export const PERSONAL_READ_PATHS = [
  "/dashboard",
  "/dashboard/library",
  "/dashboard/settings",
  "/dashboard/youtube-playlists",
  "/onboarding",
  "/entry",
] as const;

export function isMountedPersonalPath(href: string): boolean {
  const pathname = href.split(/[?#]/, 1)[0];
  return PERSONAL_READ_PATHS.some(path => path === pathname);
}

/** Testable full-document navigation seam for cross-app Active X switch redirects. */
export const personalDocumentNavigation = {
  assign: (to: string): void => window.location.assign(to),
};
