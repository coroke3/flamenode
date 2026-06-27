import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { eventGroups, eventGroupEvents, events } from "@/lib/db/schema";

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
  relation_type: string;
};

type EventGroupType = (typeof eventGroups.$inferSelect)["group_type"];
type PublicEventGroupBase = Omit<
  PublicEventGroupCard,
  "event_count" | "latest_event_title" | "latest_event_start_time"
>;

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
  const relatedEvents = (await db
    .select({
      group_id: eventGroupEvents.event_group_id,
      title: events.title,
      start_time: events.start_time,
    })
    .from(eventGroupEvents)
    .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
    .where(
      and(
        inArray(eventGroupEvents.event_group_id, groupIds),
        eq(events.is_active, 1),
        eq(events.is_archived, 0),
      ),
    )
    .orderBy(asc(eventGroupEvents.event_group_id), desc(events.start_time))) as Array<{
      group_id: string;
      title: string | null;
      start_time: number | null;
    }>;

  const eventCountByGroup = new Map<string, number>();
  const latestByGroup = new Map<
    string,
    { title: string | null; start_time: number | null }
  >();
  for (const event of relatedEvents) {
    eventCountByGroup.set(
      event.group_id,
      (eventCountByGroup.get(event.group_id) ?? 0) + 1,
    );
    if (!latestByGroup.has(event.group_id)) {
      latestByGroup.set(event.group_id, {
        title: event.title,
        start_time: event.start_time,
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
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      event_type: events.event_type,
      explanation: events.explanation,
      icon_url: events.icon_url,
      img_url: events.img_url,
      accent_color: events.accent_color,
      start_time: events.start_time,
      end_time: events.end_time,
      entry_start_time: events.entry_start_time,
      entry_end_time: events.entry_end_time,
      is_entry_open: events.is_entry_open,
      relation_type: eventGroupEvents.relation_type,
    })
    .from(eventGroupEvents)
    .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
    .where(
      and(
        eq(eventGroupEvents.event_group_id, groupId),
        eq(events.is_active, 1),
        eq(events.is_archived, 0),
      ),
    )
    .orderBy(asc(eventGroupEvents.sort_order), desc(events.start_time), asc(events.id));

  return rows;
}
