/**
 * `/event` list logic (MIG-0502 U01): the query keys, filtering, ordering and grouping of CURRENT
 * `app/(public)/event/EventIndexView.tsx`, as pure functions so the build (default view) and the
 * browser Island (`/event?q=&status=&sort=`) produce the same model.
 *
 * Island key table (CURRENT `~query` twin route -> static page + Island):
 *   q       trimmed, case-insensitive substring of title / explanation / public operator names / group name+description; empty = no filter
 *   status  all | open | upcoming | ended; empty or unknown = all
 *   sort    priority | deadline | start | new; empty or unknown = priority
 *   any other key is ignored (CURRENT reads only these three).
 */
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
  isPointEvent,
} from "../../../../src/lib/utils/eventStatusCore.ts";
import { compareEventsByUpcomingPriority } from "../../../../src/lib/utils/eventOrdering.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { buildAccentVars } from "../../../../src/lib/theme/accent.ts";
import type { StaticEventIndexEvent, StaticEventsIndex } from "../../../../src/lib/publicData/staticEventsIndexCore.ts";

export type EventFilterStatus = "all" | "open" | "upcoming" | "ended";
export type EventFilterSort = "priority" | "deadline" | "start" | "new";
export type EventsQuery = Readonly<{ q: string; status: EventFilterStatus; sort: EventFilterSort }>;

export const EVENT_FILTER_STATUSES = [
  { value: "all", label: "すべて" },
  { value: "open", label: "受付中" },
  { value: "upcoming", label: "開催前" },
  { value: "ended", label: "終了済み" },
] as const;

export const GROUP_TYPE_LABELS: Readonly<Record<string, string>> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

const EVENT_SECTIONS = [
  { id: "open", title: "募集中", sub: "Open for entry" },
  { id: "upcoming", title: "開催前", sub: "Upcoming" },
  { id: "ended", title: "開催済み", sub: "Past events" },
] as const;

export type EventCardData = Readonly<{
  id: string;
  title: string;
  imageUrl: string | null;
  iconUrl: string | null;
  statusLabel: string;
  statusTone: "ok" | "info" | "mute";
  dateLabel: string;
}>;

export type EventsIndexSection = Readonly<{
  key: string;
  /** DOM id (`event-group-{slug}`) for group sections. */
  anchorId?: string;
  title: string;
  subtitle?: string;
  iconUrl?: string | null;
  description?: string | null;
  accentStyle?: Readonly<Record<string, string>>;
  /** Two-digit count like CURRENT's `fn-evlist-count`. */
  count: string;
  events: readonly EventCardData[];
  emptyText?: string;
}>;

export type EventsIndexModel = Readonly<{
  query: EventsQuery;
  hasActiveFilter: boolean;
  /** CURRENT lead line: `{filteredEvents.length} events`. */
  total: number;
  chips: readonly { value: EventFilterStatus; label: string; href: string; active: boolean }[];
  showReset: boolean;
  sections: readonly EventsIndexSection[];
  /** null when there is something to show. */
  emptyMessage: string | null;
}>;

export function parseEventFilterStatus(value: string | null | undefined): EventFilterStatus {
  return EVENT_FILTER_STATUSES.some((s) => s.value === value) ? (value as EventFilterStatus) : "all";
}

export function parseEventFilterSort(value: string | null | undefined): EventFilterSort {
  return value === "deadline" || value === "start" || value === "new" ? value : "priority";
}

/** `location.search` (with or without `?`) -> CURRENT's three keys. */
export function parseEventsQuery(search: string): EventsQuery {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q")?.trim() ?? "",
    status: parseEventFilterStatus(params.get("status")),
    sort: parseEventFilterSort(params.get("sort")),
  };
}

function textIncludes(value: string | null | undefined, query: string): boolean {
  return !!value && value.toLocaleLowerCase().includes(query);
}

function matchesEventQuery(event: StaticEventIndexEvent, query: string): boolean {
  return (
    !query ||
    textIncludes(event.title, query) ||
    textIncludes(event.explanation, query) ||
    event.public_operator_names?.some((name) => textIncludes(name, query)) === true
  );
}

function matchesEventStatus(event: StaticEventIndexEvent, status: EventFilterStatus, now: number): boolean {
  if (status === "all") return true;
  if (status === "open") return isAcceptingEntries(event, now);
  if (status === "upcoming") return computeEventStatus(event, now) === "scheduled";
  return computeEventStatus(event, now) === "ended";
}

function sortEvents(values: StaticEventIndexEvent[], sort: EventFilterSort, now: number): StaticEventIndexEvent[] {
  const fallback = (a: StaticEventIndexEvent, b: StaticEventIndexEvent) => compareEventsByUpcomingPriority(a, b, now);
  const asc = (a: number | null, b: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);
  const desc = (a: number | null, b: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : b - a);
  return [...values].sort((a, b) => {
    if (sort === "deadline") {
      const d = asc(a.entry_end_time, b.entry_end_time);
      if (d !== 0) return d;
    } else if (sort === "start") {
      const d = asc(a.start_time, b.start_time);
      if (d !== 0) return d;
    } else if (sort === "new") {
      const d = desc(a.start_time, b.start_time);
      if (d !== 0) return d;
    }
    return fallback(a, b);
  });
}

/** CURRENT `categorizePublicEvent`. */
export function categorizePublicEvent(event: StaticEventIndexEvent, now: number): "open" | "upcoming" | "ended" {
  const status = computeEventStatus(event, now);
  if (status === "ended") return "ended";
  if (isAcceptingEntries(event, now) || status === "active" || status === "published") return "open";
  return "upcoming";
}

/** CURRENT `PublicEventCard`: date range `yyyy/mm/dd - yyyy/mm/dd` or `日程未定`. */
function formatRange(start: number | null | undefined, end: number | null | undefined): string {
  const startText = formatUnix(start, { dateOnly: true });
  const endText = formatUnix(end, { dateOnly: true });
  if (startText && endText) return `${startText} - ${endText}`;
  return startText || endText || "日程未定";
}

export function toEventCard(event: StaticEventIndexEvent, now: number): EventCardData {
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
  return {
    id: event.id,
    title: event.title,
    // CURRENT PublicEventCard: the poster goes through cachedGoogleImageUrl.
    imageUrl: cachedGoogleImageUrl(event.img_url),
    iconUrl: event.icon_url,
    statusLabel: eventStatusLabel(status),
    statusTone: accepting ? "ok" : status === "scheduled" ? "info" : "mute",
    dateLabel: formatRange(event.start_time, event.end_time),
  };
}

function chipHref(query: EventsQuery, status: EventFilterStatus): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (status !== "all") params.set("status", status);
  if (query.sort !== "priority") params.set("sort", query.sort);
  const text = params.toString();
  return text ? `/event?${text}` : "/event";
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function buildEventsIndexModel(
  index: StaticEventsIndex | null,
  query: EventsQuery,
  now: number,
): EventsIndexModel {
  const events = index?.events ?? [];
  const groupSections = index?.groupSections ?? [];
  const q = query.q;
  const lowered = q.toLocaleLowerCase();
  const { status, sort } = query;

  const matchingGroupEventIds = new Set(
    lowered
      ? groupSections
          .filter((g) => textIncludes(g.name, lowered) || textIncludes(g.description, lowered))
          .flatMap((g) => g.events.map((e) => e.id))
      : [],
  );
  const hasActiveFilter = Boolean(q) || status !== "all" || sort !== "priority";

  const filteredEvents = sortEvents(
    events.filter(
      (e) =>
        !isPointEvent(e) &&
        matchesEventStatus(e, status, now) &&
        (matchesEventQuery(e, lowered) || matchingGroupEventIds.has(e.id)),
    ),
    sort,
    now,
  );

  const groupedEventIds = new Set<string>();
  const visibleGroups = groupSections
    .map((g) => {
      const matchesGroup = !lowered || textIncludes(g.name, lowered) || textIncludes(g.description, lowered);
      const groupEvents = sortEvents(
        g.events.filter(
          (e) =>
            !isPointEvent(e) &&
            matchesEventStatus(e, status, now) &&
            (matchesGroup || matchesEventQuery(e, lowered)),
        ),
        sort,
        now,
      );
      for (const e of groupEvents) groupedEventIds.add(e.id);
      return { group: g, events: groupEvents };
    })
    .filter((g) => g.events.length > 0);
  const ungrouped = filteredEvents.filter((e) => !groupedEventIds.has(e.id));
  const hasGrouped = visibleGroups.length > 0;
  const isEmpty = hasActiveFilter ? filteredEvents.length === 0 : !hasGrouped && ungrouped.length === 0;

  const cards = (list: readonly StaticEventIndexEvent[]): EventCardData[] => list.map((e) => toEventCard(e, now));
  const sections: EventsIndexSection[] = [];
  if (!isEmpty) {
    if (hasActiveFilter) {
      sections.push({ key: "result", title: "検索結果", count: pad2(filteredEvents.length), events: cards(filteredEvents) });
    } else {
      for (const { group, events: groupEvents } of visibleGroups) {
        sections.push({
          key: `group-${group.id}`,
          anchorId: `event-group-${group.slug}`,
          title: group.name,
          subtitle: GROUP_TYPE_LABELS[group.group_type] ?? group.group_type,
          iconUrl: group.icon_url,
          description: group.description,
          accentStyle: group.accent_color
            ? ({ ...buildAccentVars(group.accent_color, "dark") } as Record<string, string>)
            : undefined,
          count: pad2(groupEvents.length),
          events: cards(groupEvents),
          emptyText: "このグループに表示できるイベントはまだありません。",
        });
      }
      if (ungrouped.length > 0) {
        if (hasGrouped) {
          sections.push({ key: "other", title: "その他のイベント", count: pad2(ungrouped.length), events: cards(ungrouped) });
        } else {
          for (const section of EVENT_SECTIONS) {
            const items = ungrouped.filter((e) => categorizePublicEvent(e, now) === section.id);
            if (items.length === 0) continue;
            sections.push({
              key: `category-${section.id}`,
              title: section.title,
              count: pad2(items.length),
              events: cards(items),
            });
          }
        }
      }
    }
  }
  return {
    query,
    hasActiveFilter,
    total: filteredEvents.length,
    chips: EVENT_FILTER_STATUSES.map((item) => ({
      value: item.value,
      label: item.label,
      href: chipHref(query, item.value),
      active: status === item.value,
    })),
    showReset: Boolean(q) || status !== "all" || sort !== "priority",
    sections,
    emptyMessage: isEmpty
      ? (index == null
          ? "公開イベント一覧を一時的に表示できません。"
          : hasActiveFilter
            ? "条件に合うイベントが見つかりませんでした。"
            : "表示できるイベントがまだありません。")
      : null,
  };
}
