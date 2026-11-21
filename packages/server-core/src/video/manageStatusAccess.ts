/**
 * MIG-0603 U02a: unmounted, read-only CURRENT-parity event status access.
 *
 * Call only AFTER Origin -> Session -> writeGuard(requiredRole:null) ->
 * CostGuard("manage_video_status"). A successful preflight is NOT sufficient
 * to activate an HTTP mutation route: full S3/D1 budget and moderation/audit/
 * R2 fencing remain STOP gates.
 */
import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { eventStaff, events, notificationOutbox, sessions, systemSettings, users, videoEvents, videos, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import { staffRowHasPermissionKey } from "@flamenode/domain/auth/permissions/resolver";
import { WRITE_FEATURE_KEYS, type WriteFeatureKey } from "@flamenode/domain/admin";
import { EVENT_STAFF_PRESETS, getPresetPermissions } from "@flamenode/domain/auth/permissions/presets";
import { assertCondition } from "../audit/mutate.ts";
import { mergeVideoRebuildEventIds, type SessionUserLike } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

// Defend against unbounded joined fan-out in D1. Exceeding this limit is
// an explicit fail-closed condition, never a partial-grant decision.
export const MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT = 256;
// Keep in sync with MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS in staticRebuild/hooks.
// This module deliberately does NOT import the much larger queue/planner chain.
export const MAX_MANAGE_STATUS_REBUILD_EVENTS = 8;
// Both UTF-16 code units and UTF-8 bytes are bounded: a multibyte imported
// event ID must not silently bypass the queue/rebuild input safety limit.
export const MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH = 4096;

function exceedsRebuildIdBytes(value: string): boolean {
  return value.length > MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH ||
    new TextEncoder().encode(value).byteLength > MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH;
}

export type ManageVideoStatusAccess =
  | { ok: true }
  | { ok: false; message: string };

// The complete row is required for the future audited transition planner:
// it checks expectedRowCondition on every original field, not only status.
// This opt-in read is NEVER returned in the active HTTP response.
export type ManageVideoStatusSnapshot =
  | { ok: true; video: typeof videos.$inferSelect; rebuildEventIds: string[];
      /** Opt-in, untrusted-at-commit notification read facts; NEVER a write grant. */
      notification?: { recipientEnabled: boolean; activeDedupe: boolean } }
  | { ok: false; message: string };

/** Reuse the same bounded projection for the unmounted admin/manage planners. */
function boundedVideoRebuildEventIdsJson(videoId: string) {
  return sql<string>`(
    SELECT COALESCE(json_group_array(linked.event_id), '[]')
    FROM (
      -- CURRENT rebuild targets omit empty-string imported event IDs.
      -- Filter BEFORE LIMIT: an empty ID must not consume a bounded slot
      -- and hide a ninth real event from the overflow detection.
      SELECT "event_id" FROM "video_events"
      WHERE "video_id" = ${videoId} AND "event_id" <> ''
      ORDER BY "event_id"
      LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
    ) linked
  )`;
}

function finishVideoStatusSnapshot(
  target: { video: typeof videos.$inferSelect; rebuildEventIdsJson: string },
): ManageVideoStatusSnapshot {
  // Fail closed on malformed aggregates and unexpectedly large imported IDs;
  // do not pass an incomplete rebuild fan-out to a future audited planner.
  const raw = target.rebuildEventIdsJson;
  if (typeof raw !== "string" || exceedsRebuildIdBytes(raw)) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  let linked: unknown;
  try {
    linked = JSON.parse(raw);
  } catch {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  if (!Array.isArray(linked) ||
      linked.length > MAX_MANAGE_STATUS_REBUILD_EVENTS + 1 ||
      !linked.every((value) => typeof value === "string")) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  // The JSON bound does not cover videos.primary_event_id. Imported data may
  // contain a very large primary ID even with zero linked rows. Guard that
  // independent input before constructing the queue/rebuild target list.
  const primaryEventId = target.video.primary_event_id;
  if (primaryEventId != null &&
      (typeof primaryEventId !== "string" ||
       exceedsRebuildIdBytes(primaryEventId))) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  const rebuildEventIds = mergeVideoRebuildEventIds(primaryEventId, linked);
  if (rebuildEventIds.length > MAX_MANAGE_STATUS_REBUILD_EVENTS) {
    return { ok: false, message: "関連イベント数が処理上限を超えています。" };
  }
  // The future atomic D1 batch binds JSON.stringify(rebuildEventIds) as ONE
  // parameter, capped at 4096 UTF-8 bytes. The linked aggregate and primary
  // ID can each fit separately while their combined deduped JSON does not.
  // Reject that snapshot now instead of returning ok:true for a transition
  // that the commit-time guard is guaranteed to reject later.
  if (exceedsRebuildIdBytes(JSON.stringify(rebuildEventIds))) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  return { ok: true, video: target.video, rebuildEventIds };
}

/**
 * #692 notifiable-status experiment: fold recipient enabled + active outbox
 * dedupe into the already authorized video snapshot SELECT. The CURRENT
 * notification builder separately reads both. This optional projection is
 * NOT yet consumed by the planner, does not replace its two reads, and is
 * NOT safe for a mutation without an atomic commit-time recheck.
 *
 * The status is a server-side validated notifiable status (not arbitrary
 * request JSON). Quiet statuses request no projection and keep the old DTO.
 */
function notificationReadProjection(
  status: "public" | "voided" | undefined,
  videoId: string,
) {
  if (!status) {
    return { recipientEnabled: sql<number>`0`, activeDedupe: sql<number>`0` };
  }
  const dedupeKey = status === "public"
    ? `video_approved:${videoId}`
    : `video_voided:${videoId}`;
  return {
    recipientEnabled: sql<number>`CASE WHEN EXISTS (
      SELECT 1 FROM ${users} notification_recipient
      WHERE notification_recipient."id" = trim(${videos.submitted_by_user_id})
        AND (notification_recipient."is_notification_enabled" IS NULL
          OR notification_recipient."is_notification_enabled" <> 0)
    ) THEN 1 ELSE 0 END`,
    activeDedupe: sql<number>`CASE WHEN EXISTS (
      SELECT 1 FROM ${notificationOutbox} notification_existing
      WHERE notification_existing."dedupe_key" = ${dedupeKey}
        AND notification_existing."status" IN ('pending', 'processing', 'sent')
    ) THEN 1 ELSE 0 END`,
  };
}

function finishVideoStatusSnapshotWithNotification(
  row: {
    video: typeof videos.$inferSelect;
    rebuildEventIdsJson: string;
    recipientEnabled: number;
    activeDedupe: number;
  },
  status?: "public" | "voided",
): ManageVideoStatusSnapshot {
  const snapshot = finishVideoStatusSnapshot(row);
  if (!snapshot.ok || !status) return snapshot;
  return {
    ...snapshot,
    notification: {
      recipientEnabled: row.recipientEnabled === 1,
      activeDedupe: row.activeDedupe === 1,
    },
  };
}

/**
 * Issue #692 / U02a research-only conditional notification outbox insert.
 *
 * Unlike CURRENT's separate recipient/dedupe pre-reads, the recipient check,
 * active dedupe check and INSERT execute in the SAME D1 statement and thus in
 * the SAME audited batch as the video status mutation. In particular, a
 * preflight snapshot is not authoritative for recipient preference/dedupe.
 *
 * This returns a batch statement; no HTTP route or planner calls it yet.
 * Future integration MUST use expectedMutationChanges=null for this safe
 * idempotent INSERT together with post-commit assertions, preserve the
 * canonical template payload bytes and obtain Lead-approved S3 acceptance.
 * forceNotify is deliberately rejected: CURRENT's forced duplicate behavior
 * cannot be silently replaced by an idempotent insert.
 */
export function planUnboundAtomicVideoStatusNotificationInsert(
  db: ServerCoreDb,
  input: {
    videoId: string;
    prevStatus: string;
    nextStatus: "public" | "voided";
    notificationId: string;
    payloadJson: string;
    eventId: string | null;
    createdAt: number;
    forceNotify?: boolean;
  },
) {
  if (input.forceNotify ||
      input.prevStatus === input.nextStatus ||
      (input.nextStatus !== "public" && input.nextStatus !== "voided") ||
      !input.videoId || !input.notificationId ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt < 0) {
    throw new Error("video_status_atomic_notification_requires_normal_validated_input");
  }
  const type = input.nextStatus === "public" ? "video_approved" : "video_voided";
  const dedupeKey = `${type}:${input.videoId}`;
  return db.run(sql`
    INSERT INTO "notification_outbox" (
      "id", "recipient_user_id", "type", "payload_json", "status",
      "attempt_count", "processing_started_at", "next_attempt_at",
      "last_error", "event_id", "dedupe_key", "created_at"
    )
    SELECT ${input.notificationId}, notification_recipient."id", ${type},
      ${input.payloadJson}, 'pending', 0, NULL, NULL, NULL,
      ${input.eventId}, ${dedupeKey}, ${input.createdAt}
    FROM "videos" notification_video
    INNER JOIN "user" notification_recipient
      ON notification_recipient."id" =
        trim(notification_video."submitted_by_user_id")
    WHERE notification_video."id" = ${input.videoId}
      -- The audited status UPDATE must have committed earlier in THIS
      -- same D1 batch. Never enqueue a public/voided notice on stale state.
      AND notification_video."visibility_status" = ${input.nextStatus}
      AND (
        notification_recipient."is_notification_enabled" IS NULL OR
        notification_recipient."is_notification_enabled" <> 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM "notification_outbox" notification_existing
        WHERE notification_existing."dedupe_key" = ${dedupeKey}
          AND notification_existing."status" IN ('pending', 'processing', 'sent')
      )
    ON CONFLICT ("dedupe_key")
      WHERE "dedupe_key" IS NOT NULL
        AND "status" IN ('pending', 'processing', 'sent')
    DO NOTHING
  `);
}

/**
 * CURRENT canEditEvent resolves approved linked X IDs, then matches event_staff
 * permission presets/custom keys. Do the same in ONE read using inner joins
 * and the SAME canonical staffRowHasPermissionKey resolver. Importantly:
 * approvedXIdsWhere() trims linked IDs before comparing with event_staff, so
 * this join must trim the linked X ID as well.
 *
 * After privilege succeeds, fetch the exact video-event link separately:
 * an unauthorized request must not discover whether a foreign video exists,
 * nor be exposed to a failure reading video_events before permission denial.
 * The site-admin branch bypasses staff roles, never the association.
 */
async function hasManageVideoStatusGrant(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const approvedStaff = await db
    .select({
      permission_preset: eventStaff.permission_preset,
      custom_permission_keys_json: eventStaff.custom_permission_keys_json,
    })
    .from(eventStaff)
    .innerJoin(
      xUserAccountLinks,
      sql`${eventStaff.x_user_id} = trim(${xUserAccountLinks.x_user_id})`,
    )
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        eq(xUserAccountLinks.auth_user_id, user.id),
        eq(xUsers.approval_status, "approved"),
      )!,
    )
    .limit(MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT + 1);
  if (approvedStaff.length > MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT) {
    // Do not authorize using an incomplete/oversized permission snapshot.
    // The isolated Hono candidate catches D1/access errors and responds
    // with a private fixed 503, without leaking a target-video association.
    throw new Error("manage_video_status_staff_read_limit_exceeded");
  }
  return approvedStaff.some((row) => staffRowHasPermissionKey(row, "video.status"));
}

/**
 * Existing status candidate: keep its small result and narrow SELECT, so no
 * extra video bytes/CPU are consumed until an audited planner is implemented.
 */
export async function checkManageVideoStatusAccess(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
): Promise<ManageVideoStatusAccess> {
  if (!(await hasManageVideoStatusGrant(db, user, eventId))) {
    return { ok: false, message: "このイベントの作品審査権限がありません。" };
  }

  const link = (
    await db
      .select({ video_id: videoEvents.video_id })
      .from(videoEvents)
      // An orphaned association is not an authorized video target. The join
      // checks target existence within the SAME single bounded D1 read.
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      // Imported/recovered association data can retain a deleted event when
      // foreign-key enforcement was disabled. Do not authorize a status
      // change against a non-existent event; this is the same one D1 read.
      .innerJoin(events, eq(events.id, videoEvents.event_id))
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }
  return { ok: true };
}

// Opt-in S3 planner preload experiment, intentionally NOT mounted in Hono.
// The exact video row is loaded in the already-required event-association
// statement, after staff permission succeeds. This can replace a separate
// planner video SELECT, but is NOT a solution to #692's overall D1 budget or
// to permission revocation between authorization and the audited commit.
export async function loadManageVideoStatusSnapshot(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
  notificationStatus?: "public" | "voided",
): Promise<ManageVideoStatusSnapshot> {
  if (!(await hasManageVideoStatusGrant(db, user, eventId))) {
    return { ok: false, message: "このイベントの作品審査権限がありません。" };
  }
  // CURRENT loadVideoRebuildEventIds performs one more D1 SELECT after
  // fetching the target. This bounded correlated JSON projection folds the
  // link fan-out into the same already-authorized exact association read.
  // The +1 row is essential: rejecting overflow must never silently discard
  // affected rebuild events. No Queue, R2, audit or mutation is performed.
  const rebuildEventIdsJson = boundedVideoRebuildEventIdsJson(videoId);
  const target = (
    await db
      .select({ video: videos, rebuildEventIdsJson,
        ...notificationReadProjection(notificationStatus, videoId) })
      .from(videoEvents)
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      .innerJoin(events, eq(events.id, videoEvents.event_id))
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }
  return finishVideoStatusSnapshotWithNotification(target, notificationStatus);
}


/**
 * Future site-admin status planner preload (UNMOUNTED, read-only).
 * CURRENT's admin action separately selects the video and its rebuild event
 * IDs. This combines both into one bounded D1 statement, without relaxing the
 * upstream Origin / Session / TOS / CostGuard or audited-write requirements.
 * The site-admin role is checked here too: direct callers must not read a
 * target video before the shared middleware verifies the identity.
 */
export async function loadAdminVideoStatusSnapshot(
  db: ServerCoreDb,
  user: SessionUserLike,
  videoId: string,
  notificationStatus?: "public" | "voided",
): Promise<ManageVideoStatusSnapshot> {
  if (user.role !== "admin") {
    return { ok: false, message: "管理者権限が必要です。" };
  }
  const target = (
    await db
      .select({
        video: videos,
        rebuildEventIdsJson: boundedVideoRebuildEventIdsJson(videoId),
        ...notificationReadProjection(notificationStatus, videoId),
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "対象作品が見つかりません。" };
  }
  return finishVideoStatusSnapshotWithNotification(target, notificationStatus);
}


/**
 * Design-only, UNMOUNTED preMutationAssertion candidate for Issue #692.
 *
 * This statement MUST be the FIRST assertion inside the SAME atomic audited
 * D1 batch that writes the new status, audit and outbox. A successful
 * preflight query is not a durable grant: staff/X links and the exact
 * video_event association can all change before the mutation begins.
 *
 * This is a narrowly scoped DB assertion, NOT an approved HTTP auth design:
 * it checks persisted actor existence/ban, base TOS acceptance, current
 * Auth.js session token ownership/expiry, current major-terms reacceptance
 * and stale site-admin role. CostGuard settings are also rechecked in this
 * unmounted candidate; real HTTP wiring/S3 acceptance remain unresolved.
 */
export function planManageVideoStatusCommitAssertion(
  db: ServerCoreDb,
  user: SessionUserLike,
  // Site-admin status input carries only videoId. Event-scoped manage calls
  // must supply an event ID to prove exact video association.
  eventId: string | null,
  videoId: string,
  // Trusted token from Auth.js session resolution, NEVER a JSON body field.
  // This signature is a design-only candidate; MIG-0602 does not expose it.
  sessionToken: string,
  // Server-owned feature key (not request JSON); shared middleware owns its policy.
  costGuardFeature: Extract<WriteFeatureKey, "manage_video_status" | "admin_video_status">,
  // Must be sourced from the successful, trusted (unmounted) video preload.
  // Never accept this array or its JSON from request-controlled input.
  expectedRebuildEventIds: readonly string[],
) {
  // Derive presets from the canonical permission definitions, rather than
  // allowing a diverging hand-maintained list in the SQL commit fence.
  const statusPresets = EVENT_STAFF_PRESETS.filter((preset) =>
    getPresetPermissions(preset).includes("video.status"),
  );

  // Custom grants are arrays of permission-key strings. SQL must reject
  // malformed JSON and scalar JSON exactly as the canonical JS resolver does.
  // Nested CASE prevents json_type() from touching invalid JSON.
  const safeKeysJson = sql`CASE WHEN json_valid(${eventStaff.custom_permission_keys_json})
    THEN CASE WHEN json_type(${eventStaff.custom_permission_keys_json}) = 'array'
      THEN ${eventStaff.custom_permission_keys_json} ELSE '[]' END
    ELSE '[]' END`;
  const hasCurrentStatusGrant = user.role === "admin"
    ? sql`1 = 1`
    : eventId === null
      ? sql`0 = 1`
      : sql`EXISTS (
      SELECT 1 FROM ${eventStaff}
      INNER JOIN ${xUserAccountLinks}
        ON ${eventStaff.x_user_id} = trim(${xUserAccountLinks.x_user_id})
      INNER JOIN ${xUsers}
        ON ${xUsers.id} = ${xUserAccountLinks.x_user_id}
      WHERE ${eventStaff.event_id} = ${eventId}
        AND ${xUserAccountLinks.auth_user_id} = ${user.id}
        AND ${xUsers.approval_status} = 'approved'
        AND (
          ${inArray(eventStaff.permission_preset, statusPresets)}
          OR (
            ${eventStaff.permission_preset} = 'custom'
            AND EXISTS (
              SELECT 1 FROM json_each(${safeKeysJson}) AS key
              WHERE key.type = 'text' AND key.value = 'video.status'
            )
          )
        )
    )`;
  // A cached actor is not durable: role downgrade, ban, or base TOS
  // acceptance withdrawal between preflight and D1 batch must fail closed.
  // Dynamic major-terms and current CostGuard are checked inside this
  // assertion; wiring their trusted context into the shared MIG-0602 route
  // and proving the route-wide S3 budget still need Issue #692 approval.
  const activeSessionStillValid = sql`EXISTS (
    SELECT 1 FROM ${sessions}
    WHERE ${sessions.sessionToken} = ${sessionToken}
      AND ${sessions.userId} = ${user.id}
      AND ${sessions.expires} > unixepoch('now') * 1000
  )`;
  // Mirrors the active Hono loadTosState guard: every once-published major
  // with a non-NULL published_at (including 0) requires consent. CURRENT's
  // termsReacceptRequiredCondition uses a falsy check and differs at epoch 0;
  // keep the commit guard fail-closed and record this parity discrepancy for
  // the cross-owner #692 decision. A mirror or historical consent, or a later
  // published version,
  // satisfies the requirement. No major publication means no reaccept gate.
  // This is part of the SAME commit-time assertion, not a fourth pre-read.
  const majorTermsStillAccepted = sql`NOT EXISTS (
    SELECT 1 FROM "terms_versions" required
    WHERE required."id" = (
      SELECT "id" FROM "terms_versions"
      WHERE "severity" = 'major' AND "published_at" IS NOT NULL
      ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM "terms_versions" accepted_terms
      WHERE accepted_terms."id" = ${users.accepted_terms_version_id}
        AND accepted_terms."published_at" IS NOT NULL
        AND (accepted_terms."id" = required."id"
          OR accepted_terms."published_at" > required."published_at")
    )
    AND NOT EXISTS (
      SELECT 1 FROM "user_tos_consents" consent
      INNER JOIN "terms_versions" consent_terms
        ON consent_terms."id" = consent."terms_version_id"
      WHERE consent."user_id" = ${users.id}
        AND consent_terms."published_at" IS NOT NULL
        AND (consent_terms."id" = required."id"
          OR consent_terms."published_at" > required."published_at")
    )
  )`;
  // Mirror evaluateCostGuardCore's fail-closed JSON parser, using a bounded
  // canonical feature list as one parameter, not an unbounded SQL IN list.
  const allowedFeaturesJson = JSON.stringify(WRITE_FEATURE_KEYS);
  function checkedList(column: SQLWrapper) {
    const safe = sql`CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END`;
    const valid = sql`CASE
      WHEN ${column} IS NULL OR ${column} = '' THEN 1
      WHEN json_valid(${column}) THEN CASE WHEN json_type(${column}) = 'array'
        AND json_array_length(${column}) <= 100
        AND NOT EXISTS (
          SELECT 1 FROM json_each(${safe}) item
          WHERE item.type <> 'text'
            OR NOT EXISTS (
              SELECT 1 FROM json_each(${allowedFeaturesJson}) allowed
              WHERE allowed.value = item.value
            )
        ) THEN 1 ELSE 0 END
      ELSE 0 END`;
    const contains = sql`EXISTS (
      SELECT 1 FROM json_each(${safe}) item
      WHERE item.type = 'text' AND item.value = ${costGuardFeature}
    )`;
    return { valid, contains };
  }
  const disabled = checkedList(systemSettings.disabled_features_json);
  const exception = checkedList(systemSettings.cost_guard_exception_features_json);
  // A reviewer cannot borrow the enabled admin-only CostGuard feature when
  // manage_video_status is disabled. This fail-closed guard is independent
  // of future Hono route middleware wiring.
  // The admin status action is global and never carries event_id; manage
  // is always event-scoped, even when invoked by a site admin. Fail closed
  // on a mismatched server-selected feature/event context, so a future Hono
  // wiring error cannot accidentally skip the manage association check.
  const featureMatchesActor = costGuardFeature === "admin_video_status"
    ? user.role === "admin" && eventId === null
    : eventId !== null;
  const costGuardStillAllows = sql`EXISTS (
    SELECT 1 FROM ${systemSettings}
    WHERE ${systemSettings.id} = 'default'
      AND ${exception.valid} = 1
      AND (
        (${systemSettings.cost_guard_exception_until} > unixepoch('now')
          AND ${exception.contains})
        OR (
          ${inArray(systemSettings.operation_mode, ["normal", "economy"])}
          AND ${disabled.valid} = 1
          AND NOT ${disabled.contains}
        )
      )
  )`;
  const actorStillAllowed = sql`EXISTS (
    SELECT 1 FROM ${users}
    WHERE ${users.id} = ${user.id}
      AND COALESCE(${users.is_banned}, 0) = 0
      AND ${users.is_tos_accepted} = 1
      AND ${majorTermsStillAccepted}
      ${user.role === "admin" ? sql`AND ${users.role} = 'admin'` : sql``}
  )`;
  // Commit-time bound mirrors hasManageVideoStatusGrant()'s preflight
  // LIMIT 257 fail-closed rule. An importer or concurrent manager may add a
  // 257th approved/joined staff row AFTER the authorized preload. A single
  // permission-granting row must not silently authorize an incomplete set.
  // The inner LIMIT caps D1 work. This is part of the first batch assertion,
  // never a fourth S3 pre-read; site-admin bypass matches preflight behavior.
  const staffRowsStillBounded = user.role === "admin"
    ? sql`1 = 1`
    : sql`(
      SELECT COUNT(*) FROM (
        SELECT 1 FROM "event_staff" bounded_staff
        INNER JOIN "x_user_account_links" bounded_link
          ON bounded_staff."x_user_id" = trim(bounded_link."x_user_id")
        INNER JOIN "x_users" bounded_x
          ON bounded_x."id" = bounded_link."x_user_id"
        WHERE bounded_staff."event_id" = ${eventId}
          AND bounded_link."auth_user_id" = ${user.id}
          AND bounded_x."approval_status" = 'approved'
        LIMIT ${MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT + 1}
      ) approved_staff
    ) <= ${MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT}`;
  // Admin video status is GLOBAL; CURRENT admin body contains no event_id.
  // Manage is event-scoped even for a site admin acting through that route.
  // A prior admin/manage status snapshot contains at most eight unique
  // rebuild targets (linked video_events plus primary_event_id). A second
  // writer may attach a ninth event AFTER that snapshot: do not commit a
  // status change whose already-planned rebuild queue omits the new target.
  // COUNT is bounded to nine IDs by LIMIT and stays inside this first atomic
  // D1 batch assertion, not an additional route-wide pre-read.
  // Mirror mergeVideoRebuildEventIds(): the canonical CURRENT queue omits
  // empty-string imported event IDs (both linked and primary). Including them
  // in the SQL union would falsely reject otherwise valid audited writes.
  const rebuildTargetsStillBounded = sql`(
    SELECT COUNT(*) FROM (
      -- The (video_id,event_id) composite PK makes each linked ID unique.
      -- Cap SOURCE rows, not just UNION output: SQLite may otherwise read
      -- every linked row to build the UNION DISTINCT temporary B-tree.
      SELECT "event_id" AS "id" FROM (
        SELECT "event_id" FROM "video_events"
        WHERE "video_id" = ${videoId} AND "event_id" <> ''
        LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
      )
      UNION
      SELECT "primary_event_id" AS "id" FROM "videos"
      WHERE "id" = ${videoId} AND "primary_event_id" IS NOT NULL
        AND "primary_event_id" <> ''
      LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
    ) current_rebuild_targets
  ) <= ${MAX_MANAGE_STATUS_REBUILD_EVENTS}`;
  // An upper bound alone is insufficient: a concurrent writer can replace
  // evB with evC while keeping total rebuild targets at two. Require EXACT
  // preloaded target-set equality at commit (including primary_event_id),
  // not only a count. The canonical preloader already returns deduped IDs.
  // The two EXCEPT directions are a strict symmetric-difference check.
  // This runs inside the first atomic D1 batch statement, never as an
  // additional S3 route read or an untrusted caller-provided authorization.
  const validExpectedIds = Array.isArray(expectedRebuildEventIds)
    && expectedRebuildEventIds.length <= MAX_MANAGE_STATUS_REBUILD_EVENTS
    && expectedRebuildEventIds.every((id) =>
      typeof id === "string" && !exceedsRebuildIdBytes(id))
    && new Set(expectedRebuildEventIds).size === expectedRebuildEventIds.length;
  const expectedIdsJson = validExpectedIds ? JSON.stringify(expectedRebuildEventIds) : "[]";
  const expectedIdsBounded = validExpectedIds && !exceedsRebuildIdBytes(expectedIdsJson);
  // Both EXCEPT directions reuse the ninth-row ceiling, including on the
  // linked-source SELECT (before UNION DISTINCT). A LIMIT on the outer UNION
  // alone does NOT guarantee a bounded SQLite source scan. The composite
  // video_events PK guarantees uniqueness of these linked event IDs.
  // When <=8 linked targets exist this remains a full exact-set comparison.
  const currentRebuildIds = sql`(
    SELECT "event_id" AS "id" FROM (
      SELECT "event_id" FROM "video_events" WHERE "video_id" = ${videoId} AND "event_id" <> ''
      LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
    )
    UNION
    SELECT "primary_event_id" AS "id" FROM "videos"
    WHERE "id" = ${videoId} AND "primary_event_id" IS NOT NULL
      AND "primary_event_id" <> ''
    LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
  )`;
  const rebuildTargetsStillIdentical = expectedIdsBounded
    ? sql`NOT EXISTS (
        SELECT "id" FROM ${currentRebuildIds}
        EXCEPT SELECT value AS "id" FROM json_each(${expectedIdsJson})
      ) AND NOT EXISTS (
        SELECT value AS "id" FROM json_each(${expectedIdsJson})
        EXCEPT SELECT "id" FROM ${currentRebuildIds}
      )`
    : sql`0 = 1`;
  const targetStillLinked = costGuardFeature === "admin_video_status"
    ? sql`EXISTS (SELECT 1 FROM ${videos} WHERE ${videos.id} = ${videoId})`
    : eventId === null
      ? sql`0 = 1`
      : sql`EXISTS (
        SELECT 1 FROM ${videoEvents}
        INNER JOIN ${videos} ON ${videos.id} = ${videoEvents.video_id}
        INNER JOIN ${events} ON ${events.id} = ${videoEvents.event_id}
        WHERE ${videoEvents.event_id} = ${eventId}
          AND ${videoEvents.video_id} = ${videoId}
      )`;
  return db.run(assertCondition(sql`${featureMatchesActor ? sql`1 = 1` : sql`0 = 1`} AND ${activeSessionStillValid} AND ${actorStillAllowed} AND ${costGuardStillAllows} AND ${hasCurrentStatusGrant} AND ${staffRowsStillBounded} AND ${rebuildTargetsStillBounded} AND ${rebuildTargetsStillIdentical} AND ${targetStillLinked}`));
}

/**
 * Design-only global site-admin first-batch guard. The admin input contract
 * supplies video_id without event_id; do not force a fabricated event link.
 * Shared identity/CostGuard/atomic audit route wiring is still UNMOUNTED.
 */
export function planAdminVideoStatusCommitAssertion(
  db: ServerCoreDb,
  user: SessionUserLike,
  videoId: string,
  sessionToken: string,
  expectedRebuildEventIds: readonly string[],
) {
  return planManageVideoStatusCommitAssertion(
    db, user, null, videoId, sessionToken, "admin_video_status", expectedRebuildEventIds,
  );
}
