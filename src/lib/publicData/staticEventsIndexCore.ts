export interface StaticEventsIndexPayload {
  generated_at?: unknown;
  items?: unknown;
  group_sections?: unknown;
}

export interface StaticEventIndexEvent {
  id: string;
  title: string;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: "public";
  is_active: number;
  is_entry_open: number;
  is_archived: number;
  event_group_id: string | null;
}

export interface StaticEventGroupSection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  accent_color: string | null;
  sort_order: number;
  latest_event_start_time: number | null;
  events: StaticEventIndexEvent[];
}

export interface StaticEventsIndex {
  events: StaticEventIndexEvent[];
  groupSections: StaticEventGroupSection[];
  generatedAt: number | null;
}

export function normalizeStaticEventsIndex(
  payload: StaticEventsIndexPayload,
): StaticEventsIndex | null {
  if (!Array.isArray(payload.items)) return null;
  const events = payload.items
    .map(normalizeEvent)
    .filter((event): event is StaticEventIndexEvent => event !== null);
  const groupSections = Array.isArray(payload.group_sections)
    ? payload.group_sections
        .map(normalizeGroupSection)
        .filter((group): group is StaticEventGroupSection => group !== null)
    : [];
  return {
    events,
    groupSections,
    generatedAt: normalizeUnix(payload.generated_at),
  };
}

function normalizeGroupSection(value: unknown): StaticEventGroupSection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const slug = normalizeString(row.slug);
  const name = normalizeString(row.name);
  if (!id || !slug || !name) return null;
  const events = Array.isArray(row.events)
    ? row.events
        .map(normalizeEvent)
        .filter((event): event is StaticEventIndexEvent => event !== null)
    : [];
  return {
    id,
    slug,
    name,
    description: normalizeNullableString(row.description),
    group_type: normalizeString(row.group_type) ?? "other",
    icon_url: normalizeNullableString(row.icon_url),
    accent_color: normalizeNullableString(row.accent_color),
    sort_order: normalizeUnix(row.sort_order) ?? 0,
    latest_event_start_time: normalizeUnix(row.latest_event_start_time),
    events,
  };
}

function normalizeEvent(value: unknown): StaticEventIndexEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    explanation: normalizeNullableString(row.explanation),
    icon_url: normalizeNullableString(row.icon_url),
    img_url: normalizeNullableString(row.img_url),
    accent_color: normalizeNullableString(row.accent_color),
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    visibility_status: "public",
    is_active: normalizeFlag(row.is_active, 1),
    is_entry_open: normalizeFlag(row.is_entry_open, 0),
    is_archived: normalizeFlag(row.is_archived, 0),
    event_group_id: normalizeNullableString(row.event_group_id),
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeUnix(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function normalizeFlag(value: unknown, fallback: number): number {
  const n = normalizeUnix(value);
  return n === 0 || n === 1 ? n : fallback;
}
