/**
 * MIG-0604 U01 (RH-014): GET /api/events/:id/slots/viewer-overlay on Hono.
 * CURRENT: app/api/events/[id]/slots/viewer-overlay/route.ts +
 * src/lib/slots/slotViewerOverlay.ts (+ slotViewerOverlayCore.ts).
 *
 * Private, per-viewer DTO: every response (200 / 400 / 404 / 503) is
 * `private, no-store, no-cache, must-revalidate`. Anonymous, unavailable-auth
 * and banned viewers get the CURRENT fixed shapes.
 *
 * D1 (ZERO_1102 S2, <= 3 statements including the session lookup):
 *   1. public event row + the viewer's own slots in this event (one JSON column)
 *   2. viewer terms + linked X + pending reservation X requests (one JSON each)
 * Anonymous requests stop after statement 1.
 *
 * FIX-0604-1: operator override must use the public event's timing and
 * approved, linked staff permissions. Bound the staff snapshot inside the
 * existing viewer statement to keep ZERO_1102's <= 3 statement budget.
 */
import { Hono } from "hono";
import type { SlotViewerOverlayResponse, SlotViewerOverlaySlot } from "@flamenode/contracts";
import { resolveReservationXIdentityFromPending, SLOT_RESERVATION_X_REQUEST_TYPES } from "@flamenode/domain/slots/reservationIdentity";
import { canActAsSlotActor, resolveSlotViewerRelation } from "@flamenode/domain/slots/slotIdentity";
import { canUseSlotOperatorOverride } from "@flamenode/domain/slots/operatorReservation";
import { staffRowHasPermissionKey, type StaffPermissionRow } from "@flamenode/domain/auth/permissions/resolver";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import {
  TERMS_REACCEPT_REQUIRED_CASE_SQL,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
  buildPersonalUser,
  computeOnboardingState,
  parseJsonColumn,
  type LinkedXRow,
  type TermsRow,
} from "../personal/context.ts";
import { MAX_LINKED_X_USERS } from "../personal/sql.ts";

const MAX_EVENT_ID_LEN = 128;
/** ZERO_1102 S2 named LIMITs (<= 100). CURRENT reads these unbounded. */
export const MAX_VIEWER_SLOTS = 100;
export const MAX_PENDING_RESERVATION_REQUESTS = 100;
export const MAX_OPERATOR_STAFF_ROWS = 100;
export const MAX_OPERATOR_STAFF_JSON_BYTES = 64 * 1024;
/** ZERO_1102 S2: a JSON column parsed here is <= 64 KiB (UTF-8 bytes). */
export const MAX_VIEWER_SLOTS_JSON_BYTES = 64 * 1024;

export const VIEWER_OVERLAY_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate";
const PRIVATE_HEADERS = {
  "Cache-Control": VIEWER_OVERLAY_CACHE_CONTROL,
  Pragma: "no-cache",
  Expires: "0",
} as const;
const UNAVAILABLE_HEADERS = { ...PRIVATE_HEADERS, "Retry-After": "3" } as const;

/** CURRENT emptySlotViewerOverlay. */
export function emptySlotViewerOverlay(authUnavailable = false): SlotViewerOverlayResponse {
  return {
    loggedIn: false,
    authUnavailable,
    isBanned: false,
    needsTermsAcceptance: false,
    canReserveSlot: false,
    canPost: false,
    operatorOverrideAllowed: false,
    viewerXId: null,
    viewerXIdNotice: null,
    slots: [],
  };
}

interface EventRow {
  visibility_status: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  slot_visibility_mode: string | null;
  viewer_slots: string | null;
}

interface ViewerSlotRow {
  id: string;
  status: string | null;
  display_name: string | null;
  x_user_id: string | null;
  reserved_x_id_snapshot: string | null;
  reserved_by_user_id: string | null;
  reservation_group_id: string | null;
  has_icon: number;
}

interface ViewerRow extends TermsRow {
  linked: string | null;
  pending: string | null;
  event_staff: string | null;
}

function userNeedsTermsAcceptance(terms: TermsRow): boolean {
  return terms.is_tos_accepted !== 1 || terms.terms_reaccept_required === 1;
}

/** Statement 1: the public event and, when there is a viewer, that viewer's own slots (<= MAX_VIEWER_SLOTS + 1 rows). */
function eventStatement(db: D1Database, eventId: string, viewerId: string | null): D1PreparedStatement {
  const columns = [
    "id",
    "status",
    "display_name",
    "x_user_id",
    "reserved_x_id_snapshot",
    "reserved_by_user_id",
    "reservation_group_id",
    "has_icon",
  ];
  const params: unknown[] = [];
  let viewerSlots = "NULL";
  if (viewerId !== null) {
    // The extra row (LIMIT + 1) only detects "more than the cap" so the route can fail closed.
    // CURRENT has no ORDER BY; its plan scans slots_event_idx (event_id, start_time), so the explicit
    // (start_time, rowid) order is that scan order and keeps the viewer-group-N numbering stable.
    viewerSlots = `(SELECT json_group_array(json_object(${columns.map((c) => `'${c}', q.${c}`).join(", ")})) FROM (
        SELECT s.id AS id, s.status AS status, s.display_name AS display_name, s.x_user_id AS x_user_id,
          s.reserved_x_id_snapshot AS reserved_x_id_snapshot, s.reserved_by_user_id AS reserved_by_user_id,
          s.reservation_group_id AS reservation_group_id,
          CASE WHEN v.creator_icon_url IS NULL OR v.creator_icon_url = '' THEN 0 ELSE 1 END AS has_icon
        FROM slots s LEFT JOIN videos v ON s.video_id = v.id
        WHERE s.event_id = e.id AND s.reserved_by_user_id = ?
        ORDER BY s.start_time, s.rowid
        LIMIT ?) q)`;
    params.push(viewerId, MAX_VIEWER_SLOTS + 1);
  }
  params.push(eventId);
  return db
    .prepare(
      `SELECT e.visibility_status AS visibility_status, e.start_time AS start_time, e.end_time AS end_time,
         e.entry_start_time AS entry_start_time, e.entry_end_time AS entry_end_time,
         e.slot_visibility_mode AS slot_visibility_mode, ${viewerSlots} AS viewer_slots
       FROM events e WHERE e.id = ? AND e.visibility_status = 'public' LIMIT 1`,
    )
    .bind(...params);
}

/**
 * Statement 2: CURRENT getCurrentUserContext terms + header linked X rows and getOnboardingState /
 * resolveReservationXIdentity pending reservation requests, as bounded JSON columns of one `user` row.
 * (Same linked-X SQL as personal/context.ts contextStatement; the pending request list is the full
 * newest-first list resolveReservationXIdentity needs, not contextStatement's single latest row.)
 */
function viewerStatement(db: D1Database, userId: string, eventId: string): D1PreparedStatement {
  const types = SLOT_RESERVATION_X_REQUEST_TYPES;
  const linked = `(SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'approval_status', q.approval_status)) FROM (
        SELECT x_users.id AS x_user_id, x_users.approval_status AS approval_status
        FROM x_user_account_links
        INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
        WHERE x_user_account_links.auth_user_id = u.id
        ORDER BY x_users.id
        LIMIT ?) q)`;
  // Match CURRENT getManageAuthorizationSnapshot: approved X links only, with permissions
  // unioned across the viewer's staff rows. LIMIT + 1 detects an incomplete snapshot.
  const eventStaff = `(SELECT json_group_array(json_object(
        'permission_preset', q.permission_preset,
        'custom_permission_keys_json', q.custom_permission_keys_json
      )) FROM (
        SELECT es.permission_preset, es.custom_permission_keys_json FROM event_staff es
        INNER JOIN x_user_account_links xl ON xl.x_user_id = es.x_user_id
        INNER JOIN x_users x ON x.id = xl.x_user_id
        WHERE es.event_id = ? AND xl.auth_user_id = u.id AND x.approval_status = 'approved'
        LIMIT ${MAX_OPERATOR_STAFF_ROWS + 1}) q)`;
  const pending = `(SELECT json_group_array(q.requested_x_id) FROM (
        SELECT requested_x_id FROM x_identity_requests
        WHERE requested_by_auth_user_id = ? AND status = 'pending'
          AND request_type IN (${types.map(() => "?").join(", ")})
          AND requested_x_id IS NOT NULL
        ORDER BY requested_at DESC, id DESC
        LIMIT ?) q)`;
  return db
    .prepare(
      `${TERMS_REACCEPT_REQUIRED_CTE_SQL}
       SELECT u.is_tos_accepted AS is_tos_accepted,
         u.accepted_terms_version_id AS accepted_terms_version_id,
         ${TERMS_REACCEPT_REQUIRED_CASE_SQL} AS terms_reaccept_required,
         ${linked} AS linked,
         ${pending} AS pending,
         ${eventStaff} AS event_staff
       FROM "user" u WHERE u.id = ? LIMIT 1`,
    )
    .bind(MAX_LINKED_X_USERS, userId, ...types, MAX_PENDING_RESERVATION_REQUESTS,
      eventId, userId);
}

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

export const slotViewerOverlayRoutes = new Hono<AppEnv>();

slotViewerOverlayRoutes.use("/:id/slots/viewer-overlay", async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(c.res.status === 503 ? UNAVAILABLE_HEADERS : PRIVATE_HEADERS)) {
    c.res.headers.set(name, value);
  }
});
slotViewerOverlayRoutes.use("/:id/slots/viewer-overlay", sessionMiddleware());

slotViewerOverlayRoutes.get("/:id/slots/viewer-overlay", async (c) => {
  const eventId = (c.req.param("id") ?? "").trim().slice(0, MAX_EVENT_ID_LEN);
  if (!eventId) return c.json({ error: "invalid_event_id" }, 400);

  const sessionUser = c.get("user");
  const sessionState = c.get("sessionState");
  const db = c.env.DB;

  let event: EventRow | null;
  try {
    // Banned viewers never get their slots (CURRENT returns before reading them).
    const slotsViewerId = sessionUser && sessionUser.is_banned !== 1 ? sessionUser.id : null;
    event = await eventStatement(db, eventId, slotsViewerId).first<EventRow>();
  } catch {
    console.error("[slot-viewer-overlay] request failed");
    return c.json({ error: "viewer_overlay_unavailable" }, 503);
  }
  if (!event) return c.json({ error: "event_not_found" }, 404);

  // CURRENT: getCurrentUser() throws CurrentUserUnavailableError -> authUnavailable overlay.
  if (sessionState === "unavailable") return c.json(emptySlotViewerOverlay(true));
  if (!sessionUser) return c.json(emptySlotViewerOverlay(false));

  let terms: TermsRow;
  let linkedRows: LinkedXRow[];
  let pendingXIds: string[];
  let operatorStaffRows: StaffPermissionRow[];
  try {
    const row = await viewerStatement(db, sessionUser.id, eventId).first<ViewerRow>();
    // The user row vanished after the session was resolved: CURRENT treats it as logged out.
    if (!row) return c.json(emptySlotViewerOverlay(false));
    terms = row;
    linkedRows = parseJsonColumn<LinkedXRow[]>(row.linked, []);
    pendingXIds = parseJsonColumn<string[]>(row.pending, []);
    if (row.event_staff !== null && utf8Length(row.event_staff) > MAX_OPERATOR_STAFF_JSON_BYTES) {
      throw new Error("event_staff_snapshot_too_large");
    }
    operatorStaffRows = parseJsonColumn<StaffPermissionRow[]>(row.event_staff, []);
    if (operatorStaffRows.length > MAX_OPERATOR_STAFF_ROWS) throw new Error("event_staff_over_limit");
  } catch {
    console.error("[slot-viewer-overlay] viewer load failed");
    return c.json(emptySlotViewerOverlay(true));
  }

  const viewer = buildPersonalUser(sessionUser, terms, linkedRows);
  if (viewer.is_banned === 1) {
    return c.json({
      ...emptySlotViewerOverlay(false),
      loggedIn: true,
      isBanned: true,
      needsTermsAcceptance: userNeedsTermsAcceptance(terms),
    });
  }
  const unavailableForViewer = (): SlotViewerOverlayResponse => ({
    ...emptySlotViewerOverlay(true),
    loggedIn: true,
    isBanned: false,
    needsTermsAcceptance: userNeedsTermsAcceptance(terms),
  });

  let slotRows: ViewerSlotRow[];
  try {
    const json = event.viewer_slots;
    if (json !== null && utf8Length(json) > MAX_VIEWER_SLOTS_JSON_BYTES) throw new Error("slots_too_large");
    slotRows = json === null ? [] : (JSON.parse(json) as ViewerSlotRow[]);
    // More than the cap: fail closed with the CURRENT "unavailable for this viewer" shape.
    if (slotRows.length > MAX_VIEWER_SLOTS) throw new Error("slots_over_limit");
  } catch {
    console.error("[slot-viewer-overlay] viewer slots over bound");
    return c.json(unavailableForViewer());
  }

  const onboarding = computeOnboardingState({
    user: viewer,
    linkedRows,
    pendingRequest: pendingXIds.length > 0 ? { requested_x_id: pendingXIds[0] ?? null } : null,
  });

  let viewerXId: string | null = null;
  if (onboarding.canReserveSlot) {
    const identity = resolveReservationXIdentityFromPending({
      activeXId: viewer.active_x_user_id,
      approvedXIds: onboarding.activeApprovedXId ? [onboarding.activeApprovedXId] : [],
      pendingRequestedXIds: pendingXIds,
    });
    viewerXId = identity.snapshotXId;
  }

  const operatorOverrideAllowed =
    onboarding.canReserveSlot &&
    canUseSlotOperatorOverride(event) &&
    (viewer.role === "admin" ||
      (onboarding.xIdentityStatus === "approved" &&
        operatorStaffRows.some((row) => staffRowHasPermissionKey(row, "event.slots"))));

  const mode = event.slot_visibility_mode;
  const groupKeys = new Map<string, string>();
  const slots: SlotViewerOverlaySlot[] = slotRows.map((slot) => {
    const viewerRelation = resolveSlotViewerRelation({
      reservedByUserId: slot.reserved_by_user_id,
      slotXUserId: slot.x_user_id,
      authUserId: viewer.id,
      activeXId: viewer.active_x_user_id ?? null,
    });
    const isOwnedByViewer = canActAsSlotActor(viewerRelation);
    const canReveal =
      viewerRelation === "active" ||
      viewerRelation === "unassigned" ||
      viewerRelation === "account_other" ||
      mode === "public_name";
    // public_name: the page's base group is authoritative; anonymous/hidden: opaque group keys for own slots only.
    const exposeViewerGroup = isOwnedByViewer && mode !== "public_name";
    let groupKey: string | null = null;
    if (exposeViewerGroup && slot.reservation_group_id) {
      groupKey = groupKeys.get(slot.reservation_group_id) ?? null;
      if (!groupKey) {
        groupKey = `viewer-group-${groupKeys.size + 1}`;
        groupKeys.set(slot.reservation_group_id, groupKey);
      }
    }
    return {
      id: slot.id,
      display_name: canReveal ? slot.display_name : null,
      reserved_x_id: canReveal ? (slot.reserved_x_id_snapshot ?? slot.x_user_id) : null,
      profile_x_user_id: canReveal && slot.x_user_id ? slot.x_user_id : null,
      submitted_icon_url:
        canReveal && slot.status === "submitted" && slot.has_icon === 1
          ? `/api/media/slot-submission-icon/${slot.id}`
          : null,
      is_owned_by_viewer: isOwnedByViewer,
      viewer_relation: viewerRelation,
      group_key: groupKey,
      x_user_id: isOwnedByViewer ? slot.x_user_id : null,
    };
  });

  return c.json({
    loggedIn: true,
    authUnavailable: false,
    isBanned: false,
    needsTermsAcceptance: onboarding.needsTermsAcceptance,
    canReserveSlot: onboarding.canReserveSlot,
    canPost: onboarding.canPost,
    operatorOverrideAllowed,
    viewerXId,
    viewerXIdNotice: null,
    slots,
  } satisfies SlotViewerOverlayResponse);
});
