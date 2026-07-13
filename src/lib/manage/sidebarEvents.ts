import {
  computeEventStatus,
} from "#utils/event-status-core";

export type ManageSidebarEventGroup =
  | "recent"
  | "active"
  | "scheduled"
  | "ended";

export type ManageSidebarEventItem = {
  id: string;
  title: string;
  accent_color: string | null;
  visibility_status: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  pending_review_count: number;
};

export function classifyManageEvent(
  event: ManageSidebarEventItem,
  now = Math.floor(Date.now() / 1000),
): Exclude<
  ManageSidebarEventGroup,
  "recent"
> {
  const status =
    computeEventStatus(event, now);

  if (
    status === "active" ||
    status === "published"
  ) {
    return "active";
  }

  if (status === "scheduled") {
    return "scheduled";
  }

  return "ended";
}

export function filterManageEvents(
  events: readonly ManageSidebarEventItem[],
  query: string,
): ManageSidebarEventItem[] {
  const normalized =
    query.trim().toLocaleLowerCase("ja");

  if (!normalized) return [...events];

  return events.filter((event) =>
    event.id
      .toLocaleLowerCase("ja")
      .includes(normalized) ||
    event.title
      .toLocaleLowerCase("ja")
      .includes(normalized),
  );
}
