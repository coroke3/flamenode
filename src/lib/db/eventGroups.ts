import { sql, eq, and, desc, asc } from "drizzle-orm";
import { eventGroups, eventGroupEvents, events } from "@/lib/db/schema";

type DB = Parameters<typeof eq>[0] extends { _: unknown } ? never : never;

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

export async function fetchPublicEventGroups(
  db: any,
  options?: { type?: string },
): Promise<PublicEventGroupCard[]> {
  const where = eq(eventGroups.visibility_status, "public");

  const groups = await db
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
    .where(where)
    .orderBy(asc(eventGroups.sort_order), asc(eventGroups.name));

  const result: PublicEventGroupCard[] = [];
  for (const g of groups) {
    if (options?.type && options.type !== "all" && g.group_type !== options.type) continue;

    const eventCount = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(eventGroupEvents)
      .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
      .where(
        and(
          eq(eventGroupEvents.event_group_id, g.id),
          eq(events.is_active, 1),
          eq(events.is_archived, 0),
        ),
      );

    const latestEvent = await db
      .select({ title: events.title, start_time: events.start_time })
      .from(eventGroupEvents)
      .innerJoin(events, eq(events.id, eventGroupEvents.event_id))
      .where(
        and(
          eq(eventGroupEvents.event_group_id, g.id),
          eq(events.is_active, 1),
          eq(events.is_archived, 0),
        ),
      )
      .orderBy(desc(events.start_time))
      .limit(1);

    result.push({
      ...g,
      event_count: Number(eventCount[0]?.c ?? 0),
      latest_event_title: latestEvent[0]?.title ?? null,
      latest_event_start_time: latestEvent[0]?.start_time ?? null,
    });
  }

  return result;
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
