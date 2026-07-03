import * as React from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import {
  PublicEventCard,
  type PublicEventCategory,
} from "@/components/event/PublicEventCard";
import { categorizePublicEvent } from "@/lib/utils/categorizePublicEvent";
import { publicListableEventWhere } from "@/lib/utils/eventStatus";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import {
  fetchEventListGroupSections,
  type EventListGroupSection,
} from "@/lib/db/eventGroups";
import { eventGroupAnchorId } from "@/lib/eventGroupRoutes";
import { loadStaticEventsIndex } from "@/lib/publicData/staticEventsIndex";
import type {
  StaticEventGroupSection,
  StaticEventIndexEvent,
} from "@/lib/publicData/staticEventsIndexCore";

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

type EventRow = typeof eventsTable.$inferSelect;
type EventListEvent = EventRow | StaticEventIndexEvent;
type EventGroupSectionView = Omit<EventListGroupSection, "events"> &
  Omit<StaticEventGroupSection, "events"> & {
    events: EventListEvent[];
  };

const GROUP_TYPE_LABELS: Record<string, string> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

const EVENT_SECTIONS: {
  id: PublicEventCategory;
  title: string;
  sub: string;
}[] = [
  { id: "open", title: "募集中", sub: "Open for entry" },
  { id: "upcoming", title: "開催前", sub: "Upcoming" },
  { id: "ended", title: "開催済み", sub: "Past events" },
  { id: "archive", title: "アーカイブ", sub: "Always-on archive" },
];

function isPointEvent(ev: EventListEvent): boolean {
  return (ev.start_time != null) !== (ev.end_time != null);
}

export default async function EventListPage(): Promise<React.ReactElement> {
  const staticIndex = await loadStaticEventsIndex();
  const source =
    staticIndex ??
    (await withDatabase(async (db) => {
      const [eventRows, groups] = await Promise.all([
        db
          .select()
          .from(eventsTable)
          .where(publicListableEventWhere())
          .orderBy(desc(eventsTable.start_time)),
        fetchEventListGroupSections(db),
      ]);
      return {
        events: eventRows as EventListEvent[],
        groupSections: groups as EventGroupSectionView[],
      };
    }));
  const { events, groupSections } = source ?? { events: [], groupSections: [] };

  const sortedEvents = events.sort(compareEventsByUpcomingPriority);
  const filteredEvents = sortedEvents.filter((ev) => !isPointEvent(ev));

  const groupedEventIds = new Set<string>();
  for (const group of groupSections) {
    for (const ev of group.events) {
      groupedEventIds.add(ev.id);
    }
  }

  const ungroupedEvents = filteredEvents.filter(
    (ev) => !groupedEventIds.has(ev.id),
  );

  const visibleGroupSections = groupSections.map((group) => ({
    ...group,
    events: [...group.events].sort(compareEventsByUpcomingPriority),
  }));

  const hasGrouped = visibleGroupSections.length > 0;
  const hasUngrouped = ungroupedEvents.length > 0;
  const isEmpty = !hasGrouped && !hasUngrouped;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <span className="fn-eyebrow">events - {filteredEvents.length} total</span>
          <h1 className="fn-display fn-evlist-title">イベント</h1>
        </div>
      </header>

      {isEmpty ? (
        <div className="fn-empty fn-mt-lg">
          <Icon name="calendar" size={24} aria-hidden />
          <p className="fn-empty-message">
            表示できるイベントがまだありません。
          </p>
        </div>
      ) : (
        <>
          {visibleGroupSections.map((group) => (
            <EventGroupSection key={group.id} group={group} />
          ))}

          {hasUngrouped ? (
            hasGrouped ? (
              <section className="fn-evlist-section">
                <div className="fn-section-head">
                  <h2 className="fn-display fn-section-title">その他のイベント</h2>
                  <span className="fn-mono fn-evlist-count">
                    {String(ungroupedEvents.length).padStart(2, "0")}
                  </span>
                </div>
                <div className="fn-evlist-grid">
                  {ungroupedEvents.map((ev) => (
                    <PublicEventCard
                      key={ev.id}
                      event={ev}
                      category={categorizePublicEvent(ev)}
                    />
                  ))}
                </div>
              </section>
            ) : (
              EVENT_SECTIONS.map((section) => {
                const items = ungroupedEvents.filter(
                  (ev) => categorizePublicEvent(ev) === section.id,
                );
                if (items.length === 0) return null;
                return (
                  <section key={section.id} className="fn-evlist-section">
                    <div className="fn-section-head">
                      <h2 className="fn-display fn-section-title">{section.title}</h2>
                      <span className="fn-mono fn-evlist-count">
                        {String(items.length).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="fn-evlist-grid">
                      {items.map((ev) => (
                        <PublicEventCard
                          key={ev.id}
                          event={ev}
                          category={section.id}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )
          ) : null}
        </>
      )}
    </div>
  );
}

function EventGroupSection({
  group,
}: {
  group: EventGroupSectionView;
}): React.ReactElement {
  return (
    <section
      id={eventGroupAnchorId(group.slug)}
      className="fn-evlist-section"
    >
      <div className="fn-section-head">
        <div className="fn-section-head-left">
          <div className="fn-section-titles">
            <h2 className="fn-display fn-section-title">{group.name}</h2>
            <span className="fn-section-jp">
              {GROUP_TYPE_LABELS[group.group_type] ?? group.group_type}
            </span>
          </div>
        </div>
      </div>
      {group.description ? (
        <p
          className="fn-muted"
          style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6 }}
        >
          {group.description}
        </p>
      ) : null}
      {group.events.length === 0 ? (
        <p className="fn-muted" style={{ margin: 0, fontSize: 13 }}>
          このグループに表示できるイベントはまだありません。
        </p>
      ) : (
        <div className="fn-evlist-grid">
          {group.events.map((ev) => (
            <PublicEventCard
              key={ev.id}
              event={ev}
              category={categorizePublicEvent(ev)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
