import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { eventGroups, eventGroupEvents, events } from "@/lib/db/schema";
import { publicListableEventWhere } from "@/lib/utils/eventStatus";

type EventRow = typeof events.$inferSelect;

export type EventListGroupSection = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  accent_color: string | null;
  sort_order: number;
  latest_event_start_time: number | null;
  events: EventRow[];
};

function mergeGroupEvents<T extends { id: string; start_time: number | null }>(
  target: Map<string, T[]>,
  groupId: string,
  event: T,
): void {
  const list = target.get(groupId) ?? [];
  if (list.some((row) => row.id === event.id)) return;
  list.push(event);
  target.set(groupId, list);
}

async function fetchPublicEventsByGroupIds(
  db: any,
  groupIds: readonly string[],
): Promise<Map<string, EventRow[]>> {
  const eventsByGroup = new Map<string, EventRow[]>();
  if (groupIds.length === 0) return eventsByGroup;

  const listable = publicListableEventWhere();

  const junctionRows = (await db
    .select({
      group_id: eventGroupEvents.event_group_id,
      event: events,
    })
    .from(eventGroupEvents)
    .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
    .where(and(inArray(eventGroupEvents.event_group_id, groupIds), listable))
    .orderBy(desc(events.start_time), asc(events.id))) as Array<{
    group_id: string;
    event: EventRow;
  }>;

  for (const row of junctionRows) {
    mergeGroupEvents(eventsByGroup, row.group_id, row.event);
  }

  return eventsByGroup;
}

/** `/event` 一覧: 公開グループごとに所属イベントを日程新しい順で返す。 */
export async function fetchEventListGroupSections(
  db: any,
): Promise<EventListGroupSection[]> {
  const groups = (await db
    .select({
      id: eventGroups.id,
      slug: eventGroups.slug,
      name: eventGroups.name,
      description: eventGroups.description,
      group_type: eventGroups.group_type,
      icon_url: eventGroups.icon_url,
      accent_color: eventGroups.accent_color,
      sort_order: eventGroups.sort_order,
    })
    .from(eventGroups)
    .where(eq(eventGroups.visibility_status, "public"))
    .orderBy(asc(eventGroups.sort_order), asc(eventGroups.name))) as Array<
    Omit<EventListGroupSection, "events" | "latest_event_start_time">
  >;
  if (groups.length === 0) return [];

  const groupIds = groups.map((group) => group.id);
  const eventsByGroup = await fetchPublicEventsByGroupIds(db, groupIds);

  const latestByGroup = new Map<string, number | null>();
  for (const [groupId, groupEvents] of eventsByGroup) {
    let latest: number | null = null;
    for (const event of groupEvents) {
      const start = event.start_time ?? 0;
      if (latest == null || start > latest) latest = event.start_time;
    }
    latestByGroup.set(groupId, latest);
  }

  return groups
    .map((group) => ({
      ...group,
      sort_order: group.sort_order ?? 0,
      latest_event_start_time: latestByGroup.get(group.id) ?? null,
      events: eventsByGroup.get(group.id) ?? [],
    }))
    .sort((a, b) => {
      const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return a.name.localeCompare(b.name, "ja");
    });
}
