import { eq, and, desc, asc, inArray, isNotNull, ne } from "drizzle-orm";
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

export type PublicEventGroupCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  event_count: number;
  latest_event_title: string | null;
  latest_event_start_time: number | null;
};

export type PublicEventGroupDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  visibility_status: string;
};

export type PublicGroupEvent = {
  id: string;
  title: string;
  event_type: string | null;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  is_entry_open: number;
  is_active: number;
  is_archived: number;
  relation_type: string;
};

type EventGroupType = (typeof eventGroups.$inferSelect)["group_type"];
type PublicEventGroupBase = Omit<
  PublicEventGroupCard,
  "event_count" | "latest_event_title" | "latest_event_start_time"
>;

const legacyGroupLinkWhere = and(
  isNotNull(events.event_group_id),
  ne(events.event_group_id, ""),
);

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

  const legacyRows = (await db
    .select({ event: events })
    .from(events)
    .where(
      and(inArray(events.event_group_id, [...groupIds]), listable, legacyGroupLinkWhere),
    )
    .orderBy(desc(events.start_time), asc(events.id))) as Array<{ event: EventRow }>;

  for (const row of legacyRows) {
    const groupId = row.event.event_group_id;
    if (!groupId) continue;
    mergeGroupEvents(eventsByGroup, groupId, row.event);
  }

  return eventsByGroup;
}

export async function fetchPublicEventGroups(
  db: any,
  options?: { type?: string },
): Promise<PublicEventGroupCard[]> {
  const filters = [eq(eventGroups.visibility_status, "public")];
  if (options?.type && options.type !== "all") {
    filters.push(eq(eventGroups.group_type, options.type as EventGroupType));
  }

  const groups = (await db
    .select({
      id: eventGroups.id,
      slug: eventGroups.slug,
      name: eventGroups.name,
      description: eventGroups.description,
      group_type: eventGroups.group_type,
      icon_url: eventGroups.icon_url,
      img_url: eventGroups.img_url,
      accent_color: eventGroups.accent_color,
    })
    .from(eventGroups)
    .where(and(...filters))
    .orderBy(asc(eventGroups.sort_order), asc(eventGroups.name))) as PublicEventGroupBase[];
  if (groups.length === 0) return [];

  const groupIds = groups.map((group) => group.id);
  const eventsByGroup = await fetchPublicEventsByGroupIds(db, groupIds);

  const eventCountByGroup = new Map<string, number>();
  const latestByGroup = new Map<
    string,
    { title: string | null; start_time: number | null }
  >();
  for (const [groupId, groupEvents] of eventsByGroup) {
    eventCountByGroup.set(groupId, groupEvents.length);
    const latest = [...groupEvents].sort(
      (a, b) => (b.start_time ?? 0) - (a.start_time ?? 0),
    )[0];
    if (latest) {
      latestByGroup.set(groupId, {
        title: latest.title,
        start_time: latest.start_time,
      });
    }
  }

  return groups.map((group) => {
      const latest = latestByGroup.get(group.id);
      return {
        ...group,
        event_count: eventCountByGroup.get(group.id) ?? 0,
        latest_event_title: latest?.title ?? null,
        latest_event_start_time: latest?.start_time ?? null,
      };
    });
}

export async function fetchPublicEventGroupBySlug(
  db: any,
  slug: string,
): Promise<PublicEventGroupDetail | null> {
  const rows = await db
    .select()
    .from(eventGroups)
    .where(
      and(
        eq(eventGroups.slug, slug),
        eq(eventGroups.visibility_status, "public"),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function fetchPublicEventsForGroup(
  db: any,
  groupId: string,
): Promise<PublicGroupEvent[]> {
  const eventsByGroup = await fetchPublicEventsByGroupIds(db, [groupId]);
  const rows = eventsByGroup.get(groupId) ?? [];

  const relationRows = (await db
    .select({
      event_id: eventGroupEvents.event_id,
      relation_type: eventGroupEvents.relation_type,
    })
    .from(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, groupId))) as Array<{
    event_id: string;
    relation_type: string;
  }>;
  const relationByEvent = new Map(
    relationRows.map((row) => [row.event_id, row.relation_type]),
  );

  return rows
    .sort(
      (a, b) =>
        (b.start_time ?? 0) - (a.start_time ?? 0) || a.id.localeCompare(b.id),
    )
    .map((event) => ({
      id: event.id,
      title: event.title,
      event_type: event.event_type,
      explanation: event.explanation,
      icon_url: event.icon_url,
      img_url: event.img_url,
      accent_color: event.accent_color,
      start_time: event.start_time,
      end_time: event.end_time,
      entry_start_time: event.entry_start_time,
      entry_end_time: event.entry_end_time,
      is_entry_open: event.is_entry_open,
      is_active: event.is_active,
      is_archived: event.is_archived,
      relation_type:
        relationByEvent.get(event.id) ??
        (event.event_group_id === groupId ? "primary" : "member"),
    }));
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
