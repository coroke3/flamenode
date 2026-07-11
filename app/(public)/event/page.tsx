import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import {
  PublicEventCard,
  type PublicEventCategory,
} from "@/components/event/PublicEventCard";
import { categorizePublicEvent } from "@/lib/utils/categorizePublicEvent";
import {
  computeEventStatus,
  isAcceptingEntries,
  isEventArchived,
  publicListableEventWhere,
} from "@/lib/utils/eventStatus";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import {
  fetchEventListGroupSections,
  type EventListGroupSection,
} from "@/lib/db/eventGroups";
import { eventGroupAnchorId } from "@/lib/eventGroupRoutes";
import { loadStaticEventsIndex } from "@/lib/publicData/staticEventsIndex";
import { canFallbackToDatabase } from "@/lib/publicData/loader";
import type {
  StaticEventGroupSection,
  StaticEventIndexEvent,
} from "@/lib/publicData/staticEventsIndexCore";

export const metadata: Metadata = { title: "イベント" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  status?: string;
  sort?: string;
}

type EventRow = typeof eventsTable.$inferSelect;
type EventListEvent = EventRow | StaticEventIndexEvent;
type EventGroupSectionView = Omit<EventListGroupSection, "events"> &
  Omit<StaticEventGroupSection, "events"> & {
    events: EventListEvent[];
  };
type EventListSource = {
  events: EventListEvent[];
  groupSections: EventGroupSectionView[];
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

const EVENT_FILTER_STATUSES = [
  { value: "all", label: "すべて" },
  { value: "open", label: "受付中" },
  { value: "upcoming", label: "開催前" },
  { value: "ended", label: "終了済み" },
  { value: "archive", label: "アーカイブ" },
] as const;

type EventFilterStatus = (typeof EVENT_FILTER_STATUSES)[number]["value"];
type EventFilterSort = "priority" | "deadline" | "start" | "new";

function parseEventFilterStatus(value: string | undefined): EventFilterStatus {
  return EVENT_FILTER_STATUSES.some((status) => status.value === value)
    ? (value as EventFilterStatus)
    : "all";
}

function parseEventFilterSort(value: string | undefined): EventFilterSort {
  return value === "deadline" || value === "start" || value === "new"
    ? value
    : "priority";
}

function textIncludes(value: string | null | undefined, query: string): boolean {
  return !!value && value.toLocaleLowerCase().includes(query);
}

function matchesEventQuery(event: EventListEvent, query: string): boolean {
  return (
    !query ||
    textIncludes(event.title, query) ||
    textIncludes(event.explanation, query)
  );
}

function matchesEventStatus(
  event: EventListEvent,
  status: EventFilterStatus,
  now: number,
): boolean {
  if (status === "all") return true;
  if (status === "archive") return isEventArchived(event);
  if (status === "open") return isAcceptingEntries(event, now);
  if (status === "upcoming") return computeEventStatus(event, now) === "scheduled";
  return computeEventStatus(event, now) === "ended";
}

function sortEvents(
  values: EventListEvent[],
  sort: EventFilterSort,
  now: number,
): EventListEvent[] {
  const fallback = (a: EventListEvent, b: EventListEvent) =>
    compareEventsByUpcomingPriority(a, b, now);
  const compareMissingLast = (a: number | null, b: number | null) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  };
  const compareMissingLastDescending = (a: number | null, b: number | null) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  };

  return [...values].sort((a, b) => {
    if (sort === "deadline") {
      const difference = compareMissingLast(a.entry_end_time, b.entry_end_time);
      if (difference !== 0) return difference;
    } else if (sort === "start") {
      const difference = compareMissingLast(a.start_time, b.start_time);
      if (difference !== 0) return difference;
    } else if (sort === "new") {
      // 静的 JSON と D1 の双方にある日時だけを使い、配信元で順序を変えない。
      const difference = compareMissingLastDescending(a.start_time, b.start_time);
      if (difference !== 0) return difference;
    }
    return fallback(a, b);
  });
}

function isPointEvent(ev: EventListEvent): boolean {
  return (ev.start_time != null) !== (ev.end_time != null);
}

export default async function EventListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const rawParams = await searchParams;
  const q = rawParams.q?.trim() ?? "";
  const query = q.toLocaleLowerCase();
  const status = parseEventFilterStatus(rawParams.status);
  const sort = parseEventFilterSort(rawParams.sort);
  const now = Math.floor(Date.now() / 1000);
  const staticLoaded = await loadStaticEventsIndex();
  const emptySource: EventListSource = { events: [], groupSections: [] };
  const staticSource: EventListSource | null = staticLoaded.index
    ? {
        events: staticLoaded.index.events,
        groupSections: staticLoaded.index.groupSections as EventGroupSectionView[],
      }
    : null;

  const source: EventListSource = canFallbackToDatabase(staticLoaded.strategy)
    ? ((await withDatabase(async (db): Promise<EventListSource> => {
        const [eventRows, groups] = await Promise.all([
          db
            .select()
            .from(eventsTable)
            .where(publicListableEventWhere())
            .orderBy(desc(eventsTable.start_time)),
          fetchEventListGroupSections(db),
        ]);
        return {
          events: eventRows,
          groupSections: groups as EventGroupSectionView[],
        };
      })) ?? staticSource ?? emptySource)
    : (staticSource ?? emptySource);
  const { events, groupSections } = source;

  const filteredEvents = sortEvents(
    events.filter(
      (event) =>
        !isPointEvent(event) &&
        matchesEventStatus(event, status, now) &&
        matchesEventQuery(event, query),
    ),
    sort,
    now,
  );

  const groupedEventIds = new Set<string>();
  const visibleGroupSections = groupSections
    .map((group) => {
      const matchesGroupQuery =
        !query ||
        textIncludes(group.name, query) ||
        textIncludes(group.description, query);
      const groupEvents = sortEvents(
        group.events.filter(
          (event) =>
            !isPointEvent(event) &&
            matchesEventStatus(event, status, now) &&
            (matchesGroupQuery || matchesEventQuery(event, query)),
        ),
        sort,
        now,
      );
      for (const event of groupEvents) groupedEventIds.add(event.id);
      return { ...group, events: groupEvents };
    })
    .filter((group) => group.events.length > 0);

  const ungroupedEvents = filteredEvents.filter((event) => !groupedEventIds.has(event.id));

  const hasGrouped = visibleGroupSections.length > 0;
  const hasUngrouped = ungroupedEvents.length > 0;
  const isEmpty = !hasGrouped && !hasUngrouped;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <span className="fn-eyebrow">EVENTS</span>
          <h1 className="fn-display fn-evlist-title">イベントを探す</h1>
          <p className="fn-page-lead">{filteredEvents.length} events</p>
        </div>
      </header>

      <form className={styles.filterForm} method="get">
        <label className={styles.searchField}>
          <Icon name="search" size={14} aria-hidden />
          <span className="fn-sr-only">イベントを検索</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="イベント名・説明を検索"
            autoComplete="off"
          />
        </label>
        <input type="hidden" name="status" value={status} />
        <label className={styles.sortField}>
          <span>並び替え</span>
          <AutoSubmitSelect name="sort" className="fn-select" defaultValue={sort}>
            <option value="priority">おすすめ順</option>
            <option value="deadline">応募締切順</option>
            <option value="start">開始日順</option>
            <option value="new">新着順</option>
          </AutoSubmitSelect>
        </label>
        <button type="submit" className="fn-btn fn-btn-ghost">
          検索
        </button>
        {q || status !== "all" || sort !== "priority" ? (
          <Link href="/event" className="fn-btn fn-btn-ghost">
            リセット
          </Link>
        ) : null}
      </form>

      <nav className={styles.statusChips} aria-label="イベントの状態">
        {EVENT_FILTER_STATUSES.map((item) => {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (item.value !== "all") params.set("status", item.value);
          if (sort !== "priority") params.set("sort", sort);
          const href = params.size > 0 ? `/event?${params}` : "/event";
          const active = status === item.value;
          return (
            <a
              key={item.value}
              href={href}
              className={`${styles.statusChip} ${active ? styles.statusChipActive : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

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
