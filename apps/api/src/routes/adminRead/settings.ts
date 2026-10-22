import { Hono } from "hono";
import type {
  AdminApiEndpointsResponse,
  AdminPermissionSimulatorResponse,
  AdminAnnouncementDetailResponse,
  AdminAnnouncementListResponse,
  AdminAuditSettingsResponse,
  AdminEventGroupDetailResponse,
  AdminEventGroupsResponse,
  AdminEventTemplatesResponse,
  AdminRuleDetailResponse,
  AdminRulesResponse,
} from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { SPOTLIGHT_KEYS, permissionLabel, presetLabel, resolveStaffPermissionKeys } from "./permissions.ts";

// MIG-0626 settings-type admin screens. D1 budget (ZERO_1102 S2): <= 3 statements per request including the
// session lookup. All reads are row reads with a named LIMIT; nothing is packed into a JSON column.

/** CURRENT app/(admin)/admin/announcements/page.tsx .limit(50). */
const MAX_ANNOUNCEMENTS = 50;
/** CURRENT app/(admin)/admin/rules/page.tsx .limit(20). */
const MAX_RULE_VERSIONS = 20;
/** CURRENT rules page counts at most 30 users (reads 31 to know whether it is a lower bound). */
const MAX_REACCEPT_COUNT = 30;
/** CURRENT app/(admin)/admin/event-groups/page.tsx .limit(100). */
const MAX_EVENT_GROUPS = 100;
/**
 * DIVERGENCE: CURRENT reads every member event of a group; this keeps the first 100 (same order) so the
 * response and the statement stay bounded.
 */
const MAX_EVENT_GROUP_MEMBERS = 100;
/** CURRENT EVENT_GROUP_EVENT_PAGE_SIZE (src/lib/admin/eventGroupEventOptions.ts). */
export const EVENT_GROUP_EVENT_PAGE_SIZE = 80;
/** DIVERGENCE: CURRENT listEventTemplatesForAdmin() is unbounded; capped at 100 (newest first). */
const MAX_EVENT_TEMPLATES = 100;

// CURRENT src/lib/audit/retention.ts DEFAULT_AUDIT_LOG_SETTINGS (used when system_settings has no "default" row).
const DEFAULT_AUDIT_LOG_SETTINGS = {
  normal_retention_days: 30,
  restorable_retention_days: 180,
  long_audit_retention_days: 365,
  max_payload_bytes: 120_000,
  compact_after_days: 30,
} as const;

const NOT_FOUND = { error: "not_found" } as const;

const GROUP_TYPES: Record<string, true> = {
  series: true,
  genre: true,
  related: true,
  collection: true,
  other: true,
};

export const adminSettingsRoutes = new Hono<AppEnv>();

// ---- /announcements (app/(admin)/admin/announcements/page.tsx) ----
adminSettingsRoutes.get("/announcements", async (c) => {
  const audienceQ = c.req.query("audience");
  const statusQ = c.req.query("status");
  const audience =
    audienceQ === "all" || audienceQ === "creators" || audienceQ === "admins" ? audienceQ : "any";
  const status = statusQ === "published" || statusQ === "draft" ? statusQ : "any";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (audience !== "any") {
    conditions.push("target_audience = ?");
    params.push(audience);
  }
  if (status === "published") conditions.push("is_published = 1");
  else if (status === "draft") conditions.push("is_published = 0");
  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, is_published, publish_at, expire_at, updated_at FROM announcements" +
      where +
      " ORDER BY created_at DESC LIMIT ?",
  )
    .bind(...params, MAX_ANNOUNCEMENTS)
    .all<AdminAnnouncementListResponse["items"][number]>();
  const body: AdminAnnouncementListResponse = { audience, status, items: results };
  return c.json(body);
});

// ---- /announcements/:id (announcements/[id]/edit/page.tsx; missing row -> notFound()) ----
adminSettingsRoutes.get("/announcements/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, title, body, severity, target_audience, is_published, publish_at, expire_at, updated_at FROM announcements WHERE id = ? LIMIT 1",
  )
    .bind(c.req.param("id"))
    .first<AdminAnnouncementDetailResponse["item"]>();
  if (!row) return c.json(NOT_FOUND, 404);
  const body: AdminAnnouncementDetailResponse = { item: row };
  return c.json(body);
});

// ---- /rules (rules/page.tsx) ----
const RULE_LIST_COLUMNS = "id, version_label, status, severity, published_at, updated_at";

adminSettingsRoutes.get("/rules", async (c) => {
  const statusQ = c.req.query("status");
  const status =
    statusQ === "published" || statusQ === "draft" || statusQ === "archived" ? statusQ : "any";

  // Statement 2: the (<= 20) version rows and the current published row, kind-tagged in one UNION ALL.
  const listParams: unknown[] = [];
  let listWhere = "";
  if (status !== "any") {
    listWhere = " WHERE status = ?";
    listParams.push(status);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT 'list' AS kind, id, version_label, status, severity, published_at, updated_at FROM (SELECT " +
      RULE_LIST_COLUMNS +
      " FROM terms_versions" +
      listWhere +
      " ORDER BY updated_at DESC LIMIT ?) " +
      "UNION ALL " +
      "SELECT 'published' AS kind, id, version_label, status, severity, published_at, updated_at FROM (SELECT " +
      RULE_LIST_COLUMNS +
      " FROM terms_versions WHERE status = 'published' ORDER BY published_at DESC, updated_at DESC LIMIT 1)",
  )
    .bind(...listParams, MAX_RULE_VERSIONS)
    .all<AdminRulesResponse["items"][number] & { kind: "list" | "published" }>();
  const items: AdminRulesResponse["items"] = [];
  let currentPublished: AdminRulesResponse["currentPublished"] = null;
  for (const { kind, ...row } of results) {
    if (kind === "list") items.push(row);
    else currentPublished = { id: row.id, version_label: row.version_label };
  }

  // Statement 3: users needing re-acceptance, counted up to 31 (CURRENT: getLatestPublishedMajorTerms +
  // termsReacceptRequiredCondition ... ORDER BY id LIMIT 31). A failure here is swallowed like CURRENT's try/catch.
  let reacceptRequiredCount = 0;
  let reacceptCountIsLowerBound = false;
  try {
    const row = await c.env.DB.prepare(
      `WITH required_major AS (
         SELECT id, published_at FROM terms_versions
         WHERE severity = 'major' AND published_at IS NOT NULL
         ORDER BY published_at DESC, updated_at DESC
         LIMIT 1
       )
       SELECT COUNT(*) AS n FROM (
         SELECT u.id FROM "user" u
         WHERE EXISTS (SELECT 1 FROM required_major WHERE published_at <> 0)
           AND u.is_tos_accepted = 1
           AND NOT (
             EXISTS (
               SELECT 1 FROM terms_versions accepted_terms
               WHERE accepted_terms.id = u.accepted_terms_version_id
                 AND accepted_terms.published_at IS NOT NULL
                 AND (accepted_terms.id = (SELECT id FROM required_major)
                   OR accepted_terms.published_at > (SELECT published_at FROM required_major))
             )
             OR EXISTS (
               SELECT 1 FROM user_tos_consents consent
               INNER JOIN terms_versions consent_terms ON consent_terms.id = consent.terms_version_id
               WHERE consent.user_id = u.id
                 AND consent_terms.published_at IS NOT NULL
                 AND (consent_terms.id = (SELECT id FROM required_major)
                   OR consent_terms.published_at > (SELECT published_at FROM required_major))
             )
           )
         ORDER BY u.id
         LIMIT ?
       )`,
    )
      .bind(MAX_REACCEPT_COUNT + 1)
      .first<{ n: number }>();
    const n = Number(row?.n ?? 0);
    reacceptCountIsLowerBound = n > MAX_REACCEPT_COUNT;
    reacceptRequiredCount = Math.min(n, MAX_REACCEPT_COUNT);
  } catch {
    console.error("[adminRead] rules reaccept count failed");
  }

  const body: AdminRulesResponse = {
    status,
    items,
    currentPublished,
    reacceptRequiredCount,
    reacceptCountIsLowerBound,
  };
  return c.json(body);
});

// ---- /rules/:id (rules/[id]/edit/page.tsx; missing row -> notFound()) ----
adminSettingsRoutes.get("/rules/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, version_label, body_markdown, severity, status FROM terms_versions WHERE id = ? LIMIT 1",
  )
    .bind(c.req.param("id"))
    .first<AdminRuleDetailResponse["item"]>();
  if (!row) return c.json(NOT_FOUND, 404);
  const body: AdminRuleDetailResponse = { item: row };
  return c.json(body);
});

// ---- /event-groups (event-groups/page.tsx) ----
adminSettingsRoutes.get("/event-groups", async (c) => {
  const visibilityQ = c.req.query("visibility");
  const typeQ = c.req.query("type");
  const visibility =
    visibilityQ === "public" || visibilityQ === "private" || visibilityQ === "archived"
      ? visibilityQ
      : "any";
  // CURRENT: sp.type && sp.type in GROUP_TYPE_LABELS
  const typeFilter = typeQ && typeQ in GROUP_TYPES ? typeQ : "any";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (visibility !== "any") {
    conditions.push("g.visibility_status = ?");
    params.push(visibility);
  }
  if (typeFilter !== "any") {
    conditions.push("g.group_type = ?");
    params.push(typeFilter);
  }
  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  const { results } = await c.env.DB.prepare(
    "SELECT g.id AS id, g.name AS name, g.slug AS slug, g.group_type AS group_type, " +
      "g.visibility_status AS visibility_status, g.sort_order AS sort_order, count(ege.event_id) AS event_count " +
      "FROM event_groups g LEFT JOIN event_group_events ege ON ege.event_group_id = g.id" +
      where +
      " GROUP BY g.id ORDER BY g.sort_order ASC, g.name ASC LIMIT ?",
  )
    .bind(...params, MAX_EVENT_GROUPS)
    .all<AdminEventGroupsResponse["items"][number]>();
  const body: AdminEventGroupsResponse = {
    visibility,
    type: typeFilter,
    items: results.map((row) => ({ ...row, event_count: Number(row.event_count) })),
  };
  return c.json(body);
});

// ---- /event-groups/:id (event-groups/[id]/edit/page.tsx; missing group -> notFound()) ----
interface GroupMemberRow {
  id: string;
  updated_at: number;
  name: string;
  slug: string;
  description: string | null;
  group_type: string;
  icon_url: string | null;
  accent_color: string | null;
  visibility_status: string;
  sort_order: number | null;
  member_event_id: string | null;
  member_title: string | null;
  member_start_time: number | null;
}

adminSettingsRoutes.get("/event-groups/:id", async (c) => {
  const id = c.req.param("id");
  // Statement 2: the group row joined with its member events (one row per member; one row with NULL member
  // columns when the group is empty), ordered as CURRENT: events.start_time DESC, events.id ASC.
  const { results } = await c.env.DB.prepare(
    "SELECT g.id AS id, g.updated_at AS updated_at, g.name AS name, g.slug AS slug, g.description AS description, " +
      "g.group_type AS group_type, g.icon_url AS icon_url, g.accent_color AS accent_color, " +
      "g.visibility_status AS visibility_status, g.sort_order AS sort_order, " +
      "m.event_id AS member_event_id, m.title AS member_title, m.start_time AS member_start_time " +
      "FROM event_groups g LEFT JOIN (" +
      "SELECT ege.event_group_id AS event_group_id, ege.event_id AS event_id, e.title AS title, e.start_time AS start_time " +
      "FROM event_group_events ege INNER JOIN events e ON e.id = ege.event_id) m ON m.event_group_id = g.id " +
      "WHERE g.id = ? ORDER BY m.start_time DESC, m.event_id ASC LIMIT ?",
  )
    .bind(id, MAX_EVENT_GROUP_MEMBERS)
    .all<GroupMemberRow>();
  const first = results[0];
  if (!first) return c.json(NOT_FOUND, 404);

  // Statement 3: events not yet in the group (CURRENT queryEventGroupEventOptions with query "" and no cursor).
  const page = await c.env.DB.prepare(
    "SELECT id, title, start_time, updated_at FROM events " +
      "WHERE NOT EXISTS (SELECT event_id FROM event_group_events WHERE event_group_id = ? AND event_id = events.id) " +
      "ORDER BY updated_at DESC, id ASC LIMIT ?",
  )
    .bind(id, EVENT_GROUP_EVENT_PAGE_SIZE + 1)
    .all<{ id: string; title: string; start_time: number | null; updated_at: number }>();
  const hasMore = page.results.length > EVENT_GROUP_EVENT_PAGE_SIZE;
  const options = page.results.slice(0, EVENT_GROUP_EVENT_PAGE_SIZE);
  const last = options.at(-1);

  const body: AdminEventGroupDetailResponse = {
    group: {
      id: first.id,
      updated_at: first.updated_at,
      name: first.name,
      slug: first.slug,
      description: first.description,
      group_type: first.group_type,
      icon_url: first.icon_url,
      accent_color: first.accent_color,
      visibility_status: first.visibility_status,
      sort_order: first.sort_order,
    },
    members: results
      .filter((row) => row.member_event_id != null)
      .map((row) => ({
        event_id: row.member_event_id as string,
        title: row.member_title as string,
        start_time: row.member_start_time,
      })),
    eventOptions: {
      options: options.map(({ id: eventId, title, start_time }) => ({ id: eventId, title, start_time })),
      nextCursor:
        hasMore && last ? JSON.stringify({ updatedAt: last.updated_at, id: last.id }) : null,
    },
  };
  return c.json(body);
});

// ---- /event-templates (events/templates/page.tsx; events/new/page.tsx via ?template=) ----
// NOT reproduced: listEventTemplatesForAdmin() runs requireAdminWrite("admin_event_templates") first and returns []
// when that write guard (cost guard / identity) fails. This read endpoint does not run the write guard.
adminSettingsRoutes.get("/event-templates", async (c) => {
  const templateId = (c.req.query("template") ?? "").trim();
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, source_event_id, updated_at FROM event_templates ORDER BY updated_at DESC LIMIT ?",
  )
    .bind(MAX_EVENT_TEMPLATES)
    .all<AdminEventTemplatesResponse["items"][number]>();
  let selected: AdminEventTemplatesResponse["selected"] = null;
  if (templateId) {
    selected = await c.env.DB.prepare(
      "SELECT id, name, settings_json FROM event_templates WHERE id = ? LIMIT 1",
    )
      .bind(templateId)
      .first<NonNullable<AdminEventTemplatesResponse["selected"]>>();
  }
  const body: AdminEventTemplatesResponse = { items: results, selected };
  return c.json(body);
});

// ---- /permissions/simulator?event_id&x_user_id (permissions/simulator/page.tsx; simulateEventPermissions) ----
// D1: session + 1 event_staff row. No input -> result null (the page renders the empty panel).
adminSettingsRoutes.get("/permissions/simulator", async (c) => {
  const eventId = (c.req.query("event_id") ?? "").trim();
  const rawX = (c.req.query("x_user_id") ?? "").trim();
  if (!eventId || !rawX) {
    const none: AdminPermissionSimulatorResponse = { eventId, xUserId: rawX, result: null };
    return c.json(none);
  }
  const xUserId = rawX.replace(/^@/, "") || null;
  const spotlight = (resolved: Set<string>) =>
    SPOTLIGHT_KEYS.map((key) => ({ key, label: permissionLabel(key), allowed: resolved.has(key) }));
  const empty: NonNullable<AdminPermissionSimulatorResponse["result"]> = {
    found: false,
    eventId,
    xUserId,
    displayName: null,
    preset: null,
    presetLabel: null,
    resolvedKeys: [],
    resolvedLabels: [],
    spotlight: spotlight(new Set()),
  };
  let result = empty;
  if (xUserId) {
    const row = await c.env.DB.prepare(
      "SELECT x_user_id, display_name, permission_preset, custom_permission_keys_json FROM event_staff WHERE event_id = ? AND x_user_id = ? LIMIT 1",
    )
      .bind(eventId, xUserId)
      .first<{
        x_user_id: string;
        display_name: string | null;
        permission_preset: string | null;
        custom_permission_keys_json: string | null;
      }>();
    if (row) {
      const preset = row.permission_preset ?? "public_staff";
      const resolved = resolveStaffPermissionKeys(row);
      const resolvedKeys = [...resolved].sort();
      result = {
        found: true,
        eventId,
        xUserId: row.x_user_id,
        displayName: row.display_name,
        preset,
        presetLabel: presetLabel(preset),
        resolvedKeys,
        resolvedLabels: resolvedKeys.map(permissionLabel),
        spotlight: spotlight(resolved),
      };
    }
  }
  const body: AdminPermissionSimulatorResponse = { eventId, xUserId: rawX, result };
  return c.json(body);
});

// ---- /api-endpoints (api-endpoints/page.tsx): events with the public export API on + public events to enable ----
const MAX_API_ENDPOINT_ROWS = 100;

adminSettingsRoutes.get("/api-endpoints", async (c) => {
  const [enabled, options] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, id AS event_id, public_api_enabled, updated_at, created_at, title AS event_title, " +
        "visibility_status AS event_visibility_status FROM events WHERE public_api_enabled = 1 " +
        "ORDER BY updated_at DESC, created_at DESC LIMIT ?",
    )
      .bind(MAX_API_ENDPOINT_ROWS)
      .all<AdminApiEndpointsResponse["rows"][number]>(),
    c.env.DB.prepare(
      "SELECT id, title, public_api_enabled AS enabled FROM events WHERE visibility_status = 'public' " +
        "ORDER BY created_at DESC LIMIT ?",
    )
      .bind(MAX_API_ENDPOINT_ROWS)
      .all<AdminApiEndpointsResponse["eventOptions"][number]>(),
  ]);
  const body: AdminApiEndpointsResponse = { rows: enabled.results, eventOptions: options.results };
  return c.json(body);
});

// ---- /audit-settings (audit/settings/page.tsx; getAuditLogSettings) ----
adminSettingsRoutes.get("/audit-settings", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT audit_normal_retention_days, audit_restorable_retention_days, audit_long_retention_days, audit_max_payload_bytes, audit_compact_after_days FROM system_settings WHERE id = 'default' LIMIT 1",
  ).first<{
    audit_normal_retention_days: number;
    audit_restorable_retention_days: number;
    audit_long_retention_days: number;
    audit_max_payload_bytes: number;
    audit_compact_after_days: number;
  }>();
  const body: AdminAuditSettingsResponse = {
    settings: row
      ? {
          normal_retention_days: row.audit_normal_retention_days,
          restorable_retention_days: row.audit_restorable_retention_days,
          long_audit_retention_days: row.audit_long_retention_days,
          max_payload_bytes: row.audit_max_payload_bytes,
          compact_after_days: row.audit_compact_after_days,
        }
      : { ...DEFAULT_AUDIT_LOG_SETTINGS },
  };
  return c.json(body);
});
