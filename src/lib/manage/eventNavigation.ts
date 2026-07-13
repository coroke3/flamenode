export type ManageEventNavKey =
  | "overview"
  | "pending"
  | "content"
  | "settings";

export function resolveManageEventNav(input: {
  pathname: string;
  searchParams: URLSearchParams;
  eventId: string;
}): ManageEventNavKey {
  const encodedId =
    encodeURIComponent(input.eventId);
  const base =
    `/manage/events/${encodedId}`;

  if (
    input.pathname === base ||
    input.pathname === `${base}/`
  ) {
    return "overview";
  }

  if (
    input.pathname.startsWith(
      `${base}/videos`,
    )
  ) {
    return input.searchParams.get("status") ===
      "pending"
      ? "pending"
      : "content";
  }

  if (
    input.pathname.startsWith(
      `${base}/slots`,
    ) ||
    input.pathname.startsWith(
      `${base}/audience`,
    )
  ) {
    return "content";
  }

  if (
    input.pathname.startsWith(
      `${base}/staff`,
    ) ||
    input.pathname.startsWith(
      `${base}/edit`,
    ) ||
    input.pathname.startsWith(
      `${base}/youtube-playlist`,
    )
  ) {
    return "settings";
  }

  return "overview";
}
