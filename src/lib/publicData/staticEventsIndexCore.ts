import { normalizePublicEventVisibility } from "./visibility.ts";

export interface StaticEventsIndexPayload {
  generated_at?: unknown;
  items?: unknown;
  group_sections?: unknown;
}

export interface StaticEventIndexEvent {
  id: string;
  title: string;
  explanation: string | null;
  public_operator_names: string[];
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  event_type: "event" | "collabo" | "type" | "other" | null;
  slot_type: "time" | "count" | null;
  slot_visibility_mode: "public_name" | "anonymous" | "hidden" | null;
  max_slots_per_video: number;
  max_consecutive_slots_per_entry: number;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: "public";
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
  const visibility = normalizePublicEventVisibility(row.visibility_status);
  if (!visibility) return null;
  return {
    id,
    title,
    explanation: normalizeNullableString(row.explanation),
    public_operator_names: normalizeStringArray(
      row.public_operator_names,
    ),
    icon_url: normalizeNullableString(row.icon_url),
    img_url: normalizeNullableString(row.img_url),
    accent_color: normalizeNullableString(row.accent_color),
    event_type: normalizeEventType(row.event_type),
    slot_type: normalizeSlotType(row.slot_type),
    slot_visibility_mode: normalizeSlotVisibilityMode(row.slot_visibility_mode),
    max_slots_per_video: normalizePositiveInteger(row.max_slots_per_video, 0),
    max_consecutive_slots_per_entry: normalizePositiveInteger(
      row.max_consecutive_slots_per_entry,
      0,
    ),
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    visibility_status: visibility,
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeEventType(
  value: unknown,
): StaticEventIndexEvent["event_type"] {
  return value === "event" || value === "collabo" || value === "type" || value === "other"
    ? value
    : null;
}

function normalizeSlotType(value: unknown): StaticEventIndexEvent["slot_type"] {
  return value === "time" || value === "count" ? value : null;
}

function normalizeSlotVisibilityMode(
  value: unknown,
): StaticEventIndexEvent["slot_visibility_mode"] {
  return value === "public_name" || value === "anonymous" || value === "hidden"
    ? value
    : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const n = normalizeUnix(value);
  return n != null && n >= 0 ? n : fallback;
}

function normalizeUnix(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim()),
    ),
  );
}
