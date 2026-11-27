import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import {
  buildEventCreateFields,
  buildEventCreateOwnerStaffRow,
  buildEventCreateStageQuestionRows,
  eventIdRenameCleanupTargets,
  parseDateInput,
  planEventCreateQuestionBatch,
} from "@flamenode/domain/event";
import {
  EVENT_CREATE_INVALID_PLAN,
  EVENT_CREATE_PLAN_FAILURE,
  planEventCreateAtomicWrite,
} from "../src/eventLifecycle/createMutationPlan.ts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildEventChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { createSqlite, createD1, insert } from "./support/personalHarness.mjs";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { eventCreateRoutes } from "../src/eventLifecycle/createRoute.ts";
import { snapshotFromEvent } from "@flamenode/domain/eventTemplates";
import {
  preCommitEventIdReuse,
  compensateEventIdReuseOnD1Failure,
} from "@flamenode/server-core/visibility/eventIdReuse";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "@flamenode/server-core/visibility/manifestCore";
import { readVisibilityManifestObject, putVisibilityManifestWithCas } from "@flamenode/server-core/visibility/manifestR2";
import { resolveEventEditPermissions } from "@flamenode/server-core/event/editPermissions";
import { buildEventUpdatePayload, EVENT_SECTION_PERMISSION_KEYS } from "@flamenode/server-core/event/updatePayload";
import * as currentEventPayload from "../../../src/lib/event/eventPayload.ts";
import * as currentEventSections from "../../../src/lib/admin/eventSectionFields.ts";

const db = drizzle(createD1(createSqlite()), { schema });
const now = 1794115200;
const owner = buildEventCreateOwnerStaffRow({
  staffId: "es_owner", eventId: "ev_create", actorUserId: "u_admin",
  verifiedOwnerIdentity: { x_user_id: "x_approved", display_name: "Approved" }, now,
});
const ownerSnapshot = {
  identity: { x_user_id: "x_approved", display_name: "Approved" },
  persistedActiveX: { type: "text", hex: Buffer.from("x_approved").toString("hex").toUpperCase() },
  displayName: { type: "text", hex: Buffer.from("Approved").toString("hex").toUpperCase() },
};
const event = buildEventCreateFields({
  id: "ev_create",
  data: {
    title: "New Event", event_type: "event", explanation: null,
    youtube_description_template: null, icon_url: null, img_url: null, accent_color: null,
    start_time: null, end_time: null, entry_start_time: null, entry_end_time: null,
    allow_user_video_event_links: 0, allow_unslotted_posts: 0, allow_user_video_edits: 0,
    max_slots_per_video: 3, max_slot_reservation_groups_per_xid: 2,
    slot_interval_minutes: null, slot_part_gap_minutes: 10,
    slot_type: "time", slot_visibility_mode: "public_name", parts_text: null,
  },
  visibilityStatus: "private", requiredVideoFieldsJson: undefined,
  templateSnapshot: null, now,
});
const createQuestions = (count) => buildEventCreateStageQuestionRows({
  eventId: "ev_create", now,
  createId: (() => { let i = 0; return () => "ecq_" + ++i; })(),
  fields: Array.from({ length: count }, (_, i) => ({
    id: "stage_permission_" + i, label: "Stage" + i,
    description: "", placeholder: "", required: false,
  })),
});
const makePlan = (overrides = {}) => {
  const questionRows = overrides.questionRows ?? createQuestions(2);
  const planned = overrides.questionChunks === undefined
    ? planEventCreateQuestionBatch({
        templateGeneralQuestions: questionRows,
        submittedGeneral: { present: false }, stageQuestions: [],
      })
    : null;
  if (planned) assert.equal(planned.ok, true);
  return planEventCreateAtomicWrite({
    db, eventRow: event, ownerRow: owner,
    questionRows, questionChunks: overrides.questionChunks ?? planned?.chunks ?? [],
    queue: { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
    actorUserId: "u_admin", ownerSnapshot, hasRenameTombstone: false,
    ...overrides,
  });
};

/** Transactional D1 on the complete migrated schema; unlike createD1 this fake
 * models D1 batch BEGIN/ROLLBACK and per-statement changes() assertions. */
function createAtomicCreateHarness({ beforeBatch = null, beforeRead = null } = {}) {
  const sqlite = createSqlite();
  const stats = { batches: 0, statements: 0, reads: 0, batchStatements: 0, maxBinds: 0 };
  let inBatch = false;
  const execSql = (sqlText, params, arrays = false) => {
    stats.statements += 1;
    if (inBatch) stats.batchStatements++;
    else {
      stats.reads++;
      beforeRead?.(sqlite, sqlText, stats.reads);
    }
    stats.maxBinds = Math.max(stats.maxBinds, params.length);
    const stmt = sqlite.prepare(sqlText);
    if (arrays) stmt.setReturnArrays(true);
    try {
      return stmt.all(...params).map(row => arrays ? [...row] : { ...row });
    } finally {
      if (arrays) stmt.setReturnArrays(false);
    }
  };
  const prepare = (sqlText, params = []) => ({
    bind: (...args) => prepare(sqlText, args),
    all: async () => ({ results: execSql(sqlText, params), success: true }),
    first: async () => execSql(sqlText, params)[0] ?? null,
    raw: async () => execSql(sqlText, params, true),
    run: async () => ({ results: execSql(sqlText, params), success: true }),
    _sql: sqlText, _params: params,
  });
  const d1 = {
    stats, prepare: (sqlText) => prepare(sqlText),
    batch: async (statements) => {
      stats.batches += 1;
      beforeBatch?.(sqlite);
      inBatch = true;
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(s => {
          const results = execSql(s._sql, s._params);
          const changes = sqlite.prepare("SELECT changes() AS n").get().n;
          return { results, success: true, meta: { changes } };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        inBatch = false;
      }
    },
  };
  return { sqlite, d1, db: drizzle(d1, { schema }) };
}

function createExecutableWritePlan(
  db,
  queue = { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
  ownerRow = owner,
) {
  const questionRows = createQuestions(2);
  const planned = planEventCreateQuestionBatch({
    templateGeneralQuestions: questionRows,
    submittedGeneral: { present: false }, stageQuestions: [],
  });
  assert.equal(planned.ok, true);
  const plan = planEventCreateAtomicWrite({
    db, eventRow: event, ownerRow,
    questionRows, questionChunks: planned.chunks,
    queue,
    actorUserId: "u_admin", ownerSnapshot, hasRenameTombstone: false,
  });
  assert.equal(plan.ok, true);
  return plan;
}

function seedCreateActor(sqlite, { status = "approved", selectedX = "x_approved", linkActor = "u_admin", linked = true } = {}) {
  insert(sqlite, "user", {
    id: "u_admin", name: "Admin", discord_id: "discord", role: "admin",
    active_x_user_id: selectedX,
  });
  if (linkActor !== "u_admin") {
    insert(sqlite, "user", { id: linkActor, role: "user" });
  }
  insert(sqlite, "x_users", {
    id: "x_approved", x_name: "Approved", approval_status: status,
  });
  if (linked) {
    insert(sqlite, "x_user_account_links", {
      x_user_id: "x_approved", auth_user_id: linkActor, link_role: "owner",
    });
  }
}

test("MIG-0652 U02 SQLite T01: strict CREATE audit, event, owner and questions commit atomically", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const plan = createExecutableWritePlan(db);
  const ids = await mutateWithAudit(db, plan);
  assert.equal(ids.length, 4, "one strict audit per inserted source row");
  assert.equal(d1.stats.batches, 1);
  // node:sqlite rows have a null prototype; compare enumerable column values.
  assert.deepEqual(
    sqlite.prepare("SELECT id, public_api_enabled FROM events").all().map(row => ({ ...row })),
    [{ id: "ev_create", public_api_enabled: 0 }],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT id, permission_preset, custom_permission_keys_json, is_public, public_role_label FROM event_staff").all().map(row => ({ ...row })),
    [{ id: "es_owner", permission_preset: "owner", custom_permission_keys_json: null, is_public: 1, public_role_label: "主催" }],
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 2);
  const auditRows = sqlite.prepare("SELECT table_name, operation, after_json FROM audit_logs ORDER BY created_at, rowid").all();
  assert.equal(auditRows.length, 4);
  assert.deepEqual(new Set(auditRows.map(row => row.table_name)),
    new Set(["events", "event_staff", "event_custom_questions"]));
  assert.ok(auditRows.every(row => row.operation === "CREATE"));
  assert.ok(auditRows.some(row => row.table_name === "events" && JSON.parse(row.after_json).public_api_enabled === 0));
  assert.ok(d1.stats.maxBinds <= 100, "Cloudflare D1 has a 100-bind per query ceiling");
});

test("MIG-0652 U02 SQLite T02: owner insert collision rolls back earlier event INSERT and all strict audits", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  // Force the second DML (owner INSERT) to fail after the event INSERT would
  // otherwise have succeeded. This must roll back the whole D1 batch.
  insert(sqlite, "event_staff", owner);
  const plan = createExecutableWritePlan(db);
  await assert.rejects(mutateWithAudit(db, plan));
  assert.equal(d1.stats.batches, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE id = 'ev_create'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE id = 'es_owner'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U02 SQLite T03: actual event-create rebuild queue commits in the audited D1 batch", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  assert.ok(queue.acceptedTargetCount > 0);
  const plan = createExecutableWritePlan(db, queue);
  assert.equal(plan.mutationStatements.length, 3 + queue.statements.length);
  assert.equal(plan.expectedMutationChanges.length, plan.mutationStatements.length);
  assert.equal(plan.budget.withinLimit, true);
  await mutateWithAudit(db, plan);

  assert.equal(d1.stats.batches, 1, "all CREATE and Queue statements share one audited D1 batch");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 4);
  const queued = sqlite.prepare("SELECT target_id, reason, status FROM static_rebuild_queue").all();
  assert.equal(queued.length, queue.acceptedTargetCount);
  assert.ok(queued.some(row => row.target_id === "ev_create"));
  assert.ok(queued.every(row => row.status === "pending" && row.reason === "event_create"));
  assert.ok(d1.stats.maxBinds <= 100);
  // This unit does not execute Hono's auth/Origin/CostGuard reads. The 18-query
  // reserve in the planner covers those future calls; this counts actual D1
  // execution in the isolated plan, not a production invocation.
  assert.ok(d1.stats.statements <= plan.budget.totalQueryCount,
    "SQLite D1 execution must not outgrow the conservative planned query budget");
});

test("MIG-0652 U02 SQLite T04: failed strict audit rolls back event, questions AND queue writes", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  const plan = createExecutableWritePlan(db, queue);
  // Fail on the audit INSERT, *after* the D1 batch has written the event,
  // owner, custom questions and static rebuild queue rows.
  sqlite.exec(
    "CREATE TRIGGER reject_create_audit BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'audit-write-denied'); END",
  );
  await assert.rejects(mutateWithAudit(db, plan), /audit-write-denied/);
  assert.equal(d1.stats.batches, 1);
  for (const table of ["events", "event_staff", "event_custom_questions", "static_rebuild_queue", "audit_logs"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
      table + " must not survive a strict audit INSERT failure");
  }
});

test("MIG-0652 U02 SQLite T05: existing pending event rebuild target is coalesced with CREATE", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  insert(sqlite, "static_rebuild_queue", {
    id: "old_pending", target_type: "event_base", target_id: "ev_create",
    reason: "older_event_update", priority: "low", status: "pending",
    attempt_count: 0, requested_by_user_id: null, created_at: 100, updated_at: 100,
  });
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  assert.ok(queue.acceptedTargetCount > 1);
  const plan = createExecutableWritePlan(db, queue);
  await mutateWithAudit(db, plan);
  assert.equal(d1.stats.batches, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n,
    queue.acceptedTargetCount, "the active target must be updated, not duplicated");
  const row = sqlite.prepare(
    "SELECT id, reason, priority, status, requested_by_user_id, updated_at " +
    "FROM static_rebuild_queue WHERE target_type = 'event_base' AND target_id = 'ev_create'",
  ).get();
  assert.equal(row.id, "old_pending", "retain the original active queue row ID");
  assert.equal(row.reason, "event_create");
  assert.equal(row.priority, "high");
  assert.equal(row.status, "pending");
  assert.equal(row.requested_by_user_id, "u_admin");
  assert.ok(row.updated_at > 100, "UPSERT must mark an already-pending target dirty");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 4);
});

test("MIG-0652 U02 SQLite T06: audit failure rolls back updates to a pre-existing queue target", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  insert(sqlite, "static_rebuild_queue", {
    id: "old_pending", target_type: "event_base", target_id: "ev_create",
    reason: "older_event_update", priority: "low", status: "pending",
    attempt_count: 0, requested_by_user_id: null, created_at: 100, updated_at: 100,
  });
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  const plan = createExecutableWritePlan(db, queue);
  sqlite.exec("CREATE TRIGGER reject_audit_queue_update BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'audit-write-denied'); END");
  await assert.rejects(mutateWithAudit(db, plan), /audit-write-denied/);
  assert.equal(d1.stats.batches, 1);
  const rows = sqlite.prepare(
    "SELECT id, reason, priority, status, requested_by_user_id, updated_at FROM static_rebuild_queue",
  ).all();
  assert.equal(rows.length, 1, "new queue fan-out targets must be rolled back");
  assert.equal(rows[0].id, "old_pending");
  assert.equal(rows[0].reason, "older_event_update");
  assert.equal(rows[0].priority, "low");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].requested_by_user_id, null);
  assert.equal(rows[0].updated_at, 100, "the existing queue UPSERT must also roll back");
  for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
      table + " cannot commit when the strict audit fails");
  }
});

test("MIG-0652 U02 SQLite T07: unapproved, unlinked or inactive X identity fails before event INSERT", async () => {
  const invalid = [
    { status: "pending" },
    { status: "rejected" },
    { selectedX: "x_other" },
    { linkActor: "u_other" },
    { linked: false },
  ];
  for (const options of invalid) {
    const { sqlite, d1, db } = createAtomicCreateHarness();
    seedCreateActor(sqlite, options);
    const plan = createExecutableWritePlan(db);
    assert.equal(plan.preMutationAssertions.length, 1);
    assert.equal(plan.budget.preMutationAssertionCount, 1);
    await assert.rejects(mutateWithAudit(db, plan),
      "unverified owner must abort the D1 batch: " + JSON.stringify(options));
    assert.equal(d1.stats.batches, 1);
    for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
        table + " must not be created for " + JSON.stringify(options));
    }
  }
});

test("MIG-0652 U02 SQLite T08: revoking a linked owner after planning but before D1 commit aborts atomically", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  const plan = createExecutableWritePlan(db, queue);
  // The future Hono preflight could pass while the approved X account is
  // revoked before the final atomic batch begins.
  sqlite.prepare("UPDATE x_users SET approval_status = 'rejected' WHERE id = 'x_approved'").run();
  await assert.rejects(mutateWithAudit(db, plan));
  assert.equal(d1.stats.batches, 1);
  for (const table of ["events", "event_staff", "event_custom_questions", "static_rebuild_queue", "audit_logs"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
      table + " must not survive revoked owner identity");
  }
});

test("MIG-0652 U02 SQLite T09: forged owner display name cannot be audited or committed", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const plan = makePlan({ db, ownerRow: { ...owner, display_name: "FORGED" } });
  assert.deepEqual(plan, { ok: false, message: EVENT_CREATE_INVALID_PLAN });
  assert.equal(d1.stats.batches, 0, "decoded owner fields must match the authoritative snapshot before planning");
  for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0);
  }
});

test("MIG-0652 U02 SQLite T10: changed X display name after preflight invalidates owner snapshot", async () => {
  const { sqlite, d1, db } = createAtomicCreateHarness();
  seedCreateActor(sqlite);
  const queue = await buildEventChangeQueueBatch(db, {
    eventId: "ev_create", reason: "event_create", requestedByUserId: "u_admin", priority: "high",
  });
  const plan = createExecutableWritePlan(db, queue);
  sqlite.prepare("UPDATE x_users SET x_name = 'Renamed' WHERE id = 'x_approved'").run();
  await assert.rejects(mutateWithAudit(db, plan));
  assert.equal(d1.stats.batches, 1);
  for (const table of ["events", "event_staff", "event_custom_questions", "static_rebuild_queue", "audit_logs"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
      table + " must not survive stale owner display");
  }
  assert.equal(sqlite.prepare("SELECT x_name FROM x_users WHERE id = 'x_approved'").get().x_name, "Renamed");
});

test("MIG-0652 U02 atomic create: event, owner, ordered question chunks and strict audits are bundled", () => {
  const result = makePlan();
  assert.equal(result.ok, true);
  assert.equal(result.mutationStatements.length, 3);
  assert.deepEqual(result.expectedMutationChanges, [1, 1, 2]);
  assert.deepEqual(result.audits.map((a) => [a.table_name, a.target_id, a.operation]),
    [["events", "ev_create", "CREATE"], ["event_staff", "es_owner", "CREATE"],
     ["event_custom_questions", "ecq_1", "CREATE"],
     ["event_custom_questions", "ecq_2", "CREATE"]]);
  assert.ok(result.audits.every((a) => a.strict === true && a.actor_user_id === "u_admin"));
  assert.equal(result.audits[1].restore_strategy, "delete_created");
  assert.equal(result.audits[1].retention_class, "long_audit");
  assert.equal(result.audits[0].after.id, "ev_create");
  assert.equal(result.audits[1].after.x_user_id, "x_approved");
  assert.equal(result.budget.withinLimit, true);
  assert.equal(result.budget.reservedCallerQueryCount, 18);
  assert.equal(result.preMutationAssertions.length, 1);
  assert.equal(result.budget.preMutationAssertionCount, 1);
});

test("MIG-0652 U02 atomic create: empty questions do not emit an empty Drizzle INSERT", () => {
  const result = makePlan({ questionRows: [], questionChunks: [] });
  assert.equal(result.ok, true);
  assert.equal(result.mutationStatements.length, 2);
  assert.deepEqual(result.expectedMutationChanges, [1, 1]);
  assert.equal(result.audits.length, 2);
});

test("MIG-0652 U02 atomic create: unsafe event IDs rejected before any D1 mutation", () => {
  for (const id of [
    "", "..", "with/slash", "with.dot", "with space",
    " with-space", "日本語", "x".repeat(65), "line\nfeed",
    "foo%2Fbar", "trailing ", "one:two",
  ]) {
    assert.deepEqual(makePlan({ eventRow: { ...event, id } }),
      { ok: false, message: EVENT_CREATE_INVALID_PLAN },
      "malformed event ID must fail: " + JSON.stringify(id));
  }
});

test("MIG-0652 U02 atomic create: route-safe 64-character event ID remains valid", () => {
  const id = "A".repeat(64);
  const rows = createQuestions(2).map(row => ({ ...row, event_id: id }));
  const plan = makePlan({
    eventRow: { ...event, id },
    ownerRow: { ...owner, event_id: id },
    questionRows: rows,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.audits[0].target_id, id);
  assert.equal(plan.audits[1].after.event_id, id);
  assert.ok(plan.audits.slice(2).every(audit => audit.after.event_id === id));
});

test("MIG-0652 U02 atomic create: missing approved actor linkage and mismatched event IDs fail closed", () => {
  const invalid = [
    { ownerRow: { ...owner, event_id: "other" } },
    { ownerRow: { ...owner, approved_by_auth_user_id: "other" } },
    { ownerRow: { ...owner, permission_preset: "public_staff" } },
    { ownerRow: { ...owner, x_user_id: "" } },
    { actorUserId: "" },
    { eventRow: { ...event, id: "" } },
    { questionRows: [{ ...createQuestions(1)[0], event_id: "other" }], questionChunks: [[{ ...createQuestions(1)[0], event_id: "other" }]] },
  ];
  for (const change of invalid) assert.deepEqual(makePlan(change), { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: initial public API and owner grants cannot be escalated", () => {
  // CURRENT createEvent fixes public_api_enabled=0 and initial owner fields.
  // Even a future Hono adapter with a malformed "validated" row must never
  // silently enable event export or grant extra owner permissions.
  const invalid = [
    { eventRow: { ...event, public_api_enabled: 1 } },
    { eventRow: { ...event, public_api_enabled: undefined } },
    { ownerRow: { ...owner, is_public: 0 } },
    { ownerRow: { ...owner, public_role_label: "admin" } },
    { ownerRow: { ...owner, custom_permission_keys_json: '["admin_manage_users"]' } },
    { ownerRow: { ...owner, custom_permission_keys_json: undefined } },
  ];
  for (const changed of invalid) {
    assert.deepEqual(makePlan(changed),
      { ok: false, message: EVENT_CREATE_INVALID_PLAN });
  }
  // Public event creation is still valid; it must *not* auto-enable public API.
  const publicPlan = makePlan({ eventRow: { ...event, visibility_status: "public" } });
  assert.equal(publicPlan.ok, true);
  assert.equal(publicPlan.audits[0].after.public_api_enabled, 0);
  assert.equal(publicPlan.audits[1].after.permission_preset, "owner");
  assert.equal(publicPlan.audits[1].after.public_role_label, "主催");
});

test("MIG-0652 U02 atomic create: forged tombstone reuse cannot bypass R2 precommit", () => {
  assert.deepEqual(makePlan({ hasRenameTombstone: true }),
    { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: duplicate question identifiers and keys are rejected", () => {
  const rows = createQuestions(2);
  assert.deepEqual(makePlan({ questionRows: [rows[0], { ...rows[1], id: rows[0].id }],
    questionChunks: [[rows[0], { ...rows[1], id: rows[0].id }]] }),
    { ok: false, message: EVENT_CREATE_INVALID_PLAN });
  assert.deepEqual(makePlan({ questionRows: [rows[0], { ...rows[1], question_key: rows[0].question_key }],
    questionChunks: [[rows[0], { ...rows[1], question_key: rows[0].question_key }]] }),
    { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: missing, reordered and oversized question chunks are rejected", () => {
  const rows = createQuestions(2);
  for (const chunks of [[], [[rows[1], rows[0]]], [[], rows], [rows, rows]]) {
    assert.deepEqual(makePlan({ questionRows: rows, questionChunks: chunks }),
      { ok: false, message: EVENT_CREATE_INVALID_PLAN });
  }
  const over = createQuestions(7);
  assert.deepEqual(makePlan({ questionRows: over, questionChunks: [over] }),
    { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: queue assertions must match queue statements before D1 commit", () => {
  const result = makePlan({ queue: { statements: [], expectedChanges: [1], acceptedTargetCount: 1 } });
  assert.deepEqual(result, { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: unsupported >18 question rows fail closed, no batch allocated", () => {
  const rows = createQuestions(19);
  // Bypass the higher-level question planner deliberately; the atomic plan
  // MUST still enforce the canonical combined create limit as defence in depth.
  const chunks = [rows.slice(0, 6), rows.slice(6, 12), rows.slice(12, 18), rows.slice(18)];
  const result = makePlan({ questionRows: rows, questionChunks: chunks });
  assert.deepEqual(result, { ok: false, message: EVENT_CREATE_INVALID_PLAN });
});

test("MIG-0652 U02 atomic create: source keeps unmounted route and no premature Queue wakes", async () => {
  const core = await readFile(new URL("../src/eventLifecycle/createMutationPlan.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/routes/events/index.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8");
  assert.doesNotMatch(app, /createMutationPlan|createRoute/);
  assert.match(core, /planAtomicAuditMutationBudget\(write\)/);
  assert.match(core, /mutationStatements, expectedMutationChanges, preMutationAssertions, audits/);
  assert.match(core, /approval_status/);
  assert.match(core, /hex\(CAST\(\$\{xUsers\.x_name\} AS BLOB\)\) = \$\{ownerSnapshot\.displayName\.hex/);
  assert.ok(core.includes("EVENT_ID_PATTERN.test(eventRow.id)"));
  assert.doesNotMatch(core, /staticRebuildWakeSource:/);
  assert.match(source, /const mutationStatements = \[/);
  assert.match(source, /context: "event-create:owner"/);
  assert.match(source, /restore_strategy: "delete_created"/);
  assert.match(source, /public_api_enabled: 0/);
  assert.match(core, /eventRow\.public_api_enabled !== 0/);
  assert.match(core, /ownerRow\.custom_permission_keys_json !== null/);
});

const SITE = "https://app.flamenode.example";
const SESSION_TOKEN = "11111111-1111-4111-8111-111111111111";
const SESSION_COOKIE = "__Secure-authjs.session-token=" + SESSION_TOKEN;
const CREATE_BODY = { id: "ev_create", title: " New Event ", max_slots_per_video: "20" };

/** Actual admin parent and cookie session over the existing transactional D1. */
function createRouteFixture(options = {}) {
  const harness = createAtomicCreateHarness(options);
  const { sqlite, d1 } = harness;
  seedCreateActor(sqlite, options);
  sqlite.prepare('UPDATE "user" SET role = ?, is_banned = ?, is_tos_accepted = ? WHERE id = ?')
    .run(options.role ?? "admin", options.isBanned ?? 0, options.tosAccepted ?? 1, "u_admin");
  sqlite.prepare("UPDATE system_settings SET operation_mode = ?, audit_max_payload_bytes = 120000 WHERE id = 'default'")
    .run(options.mode ?? "normal");
  insert(sqlite, "session", {
    sessionToken: SESSION_TOKEN, userId: "u_admin",
    expires: Date.now() + (options.expired ? -60_000 : 86_400_000),
  });
  const admin = createAdminRoutes();
  admin.route("/events", eventCreateRoutes);
  const app = new Hono();
  app.route("/api/admin", admin);
  let externalCalls = 0;
  const external = () => { externalCalls++; throw new Error("unexpected external call"); };
  const env = { DB: d1, NEXT_PUBLIC_SITE_URL: SITE,
    BUCKET: { get: external, put: external, delete: external },
    STATIC_REBUILD_QUEUE: { send: external, sendBatch: external },
  };
  const request = (body = CREATE_BODY, { cookie = SESSION_COOKIE, origin = SITE, raw, headers = {} } = {}) =>
    app.request(SITE + "/api/admin/events", {
      method: "POST",
      headers: { "content-type": "application/json",
        ...(origin === null ? {} : { Origin: origin }),
        ...(cookie === null ? {} : { Cookie: cookie }), ...headers,
      },
      body: raw ?? JSON.stringify(body),
    }, env);
  return { ...harness, request, app, env, externalCalls: () => externalCalls };
}

function assertNoCreatedRows(sqlite) {
  for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs", "static_rebuild_queue"]) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
}

function addApprovedLink(sqlite, id, { name = id, role = "owner", status = "approved" } = {}) {
  insert(sqlite, "x_users", { id, x_name: name, approval_status: status });
  insert(sqlite, "x_user_account_links", { x_user_id: id, auth_user_id: "u_admin", link_role: role });
}

function seedTemplate(sqlite, count = 1) {
  const templateEvent = { ...event, required_video_fields_json: '["music"]',
    review_settings: '{"approved":true}', editable_fields: '["title"]', repeat_rules: '["weekly"]' };
  const rows = Array.from({ length: count }, (_, i) => ({
    question_key: "template_" + i, label: "Template " + i, description: "description",
    type: "textarea", required: 0, options_json: null, placeholder: "placeholder",
    max_length: 1000, sort_order: i, is_active: 1, visibility: "review",
  }));
  const snapshot = snapshotFromEvent(templateEvent, rows,
    '{"stage_permissions":[{"id":"stage_permission_template","enabled":true,"label":"Template stage"}]}');
  insert(sqlite, "event_templates", {
    id: "et_test", name: "Template", settings_json: JSON.stringify(snapshot),
    created_by_user_id: "u_admin", created_at: 100, updated_at: 100,
  });
  return snapshot;
}

test("MIG-0652 U03: real-cookie admin create persists exact fields, owner, audit and Queue in one batch", async () => {
  const { sqlite, d1, request, externalCalls } = createRouteFixture();
  const response = await request({ ...CREATE_BODY, visibility_status: "public",
    icon_url: "https://user:secret@example.com/icon", youtube_description_template: " line1\r\nline2 ",
    public_api_enabled: "1", review_settings: "untrusted", editable_fields: "untrusted", repeat_rules: "untrusted",
    custom_questions_present: "1", custom_question_id: ["stage_permission_a", "stage_permission_a"],
    custom_question_enabled: ["1", "1"], custom_question_required: ["0", "1"],
    custom_question_label: [" First label ", "Ignored label"],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, eventId: "ev_create", pendingPublicReflection: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const row = sqlite.prepare("SELECT * FROM events").get();
  assert.equal(row.title, "New Event");
  assert.equal(row.max_slots_per_video, 20, "CURRENT form cap is 20, not the unrelated event limit 3");
  assert.equal(row.visibility_status, "public");
  assert.equal(row.public_api_enabled, 0);
  assert.equal(row.icon_url, null);
  assert.equal(row.youtube_description_template, "line1\nline2");
  for (const key of ["review_settings", "editable_fields", "repeat_rules"]) assert.equal(row[key], null);
  const ownerRow = sqlite.prepare("SELECT * FROM event_staff").get();
  assert.equal(ownerRow.x_user_id, "x_approved");
  assert.equal(ownerRow.permission_preset, "owner");
  assert.equal(ownerRow.is_public, 1);
  assert.equal(ownerRow.public_role_label, "主催");
  assert.equal(ownerRow.custom_permission_keys_json, null);
  const question = sqlite.prepare("SELECT * FROM event_custom_questions").get();
  assert.equal(question.label, "First label");
  assert.equal(question.required, 1, "duplicate stage IDs merge required with OR");
  const audits = sqlite.prepare("SELECT table_name, after_json FROM audit_logs").all();
  assert.equal(audits.length, 3);
  assert.deepEqual(JSON.parse(audits.find(a => a.table_name === "events").after_json), { ...row });
  assert.equal(d1.stats.reads, 7, "session + terms + CostGuard + duplicate + tombstone + linked-X resolution + exact owner");
  assert.equal(d1.stats.batches, 1);
  assert.ok(d1.stats.statements <= 50);
  assert.ok(d1.stats.maxBinds <= 100);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 9);
  assert.equal(externalCalls(), 0, "no R2, Queue wake or remote side effect");
});

test("MIG-0652 U03: template defaults inherit only when presence flags are absent", async () => {
  for (const explicitEmpty of [false, true]) {
    const { sqlite, d1, request } = createRouteFixture();
    const snapshot = seedTemplate(sqlite);
    const body = { ...CREATE_BODY, template_id: "et_test", review_settings: "form override",
      ...(explicitEmpty ? { required_video_fields_present: "1", required_video_fields_json: "[]",
        general_custom_questions_present: "1", general_custom_question_key: [] } : {}),
    };
    const response = await request(body);
    assert.equal(response.status, 200);
    const row = sqlite.prepare("SELECT * FROM events").get();
    assert.equal(row.required_video_fields_json, explicitEmpty ? null : snapshot.required_video_fields_json);
    for (const key of ["review_settings", "editable_fields", "repeat_rules"]) assert.equal(row[key], snapshot[key]);
    const questions = sqlite.prepare("SELECT question_key FROM event_custom_questions").all();
    assert.deepEqual(questions.map(q => q.question_key), explicitEmpty ? [] : ["template_0"]);
    assert.equal(d1.stats.reads, 8, "template costs one read, audit preloads do not reread");
    assert.equal(d1.stats.batches, 1);
  }
});

test("MIG-0652 U03: ordered repeated controls preserve scalar last value and first presence flag", async () => {
  const { sqlite, request } = createRouteFixture();
  seedTemplate(sqlite);
  const response = await request({ ...CREATE_BODY, template_id: "et_test", title: ["first", "last"],
    required_video_fields_present: ["0", "1"], required_video_fields_json: "[]",
    general_custom_questions_present: "1", general_custom_question_key: ["q_one"],
    general_custom_question_type: ["checkbox"], general_custom_question_label: [" Choices "],
    general_custom_question_options: [" a \na\nb"], general_custom_question_enabled: ["0"],
  });
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare("SELECT title FROM events").get().title, "last");
  assert.equal(sqlite.prepare("SELECT required_video_fields_json FROM events").get().required_video_fields_json, '["music"]');
  const q = sqlite.prepare("SELECT * FROM event_custom_questions").get();
  assert.equal(q.label, "Choices");
  assert.equal(q.options_json, '["a","b"]');
  assert.equal(q.is_active, 0, "disabled definitions remain persisted and audited");
});

test("MIG-0652 U03: full 18-question template/stage create remains within actual D1 bounds", async (t) => {
  const { sqlite, d1, request } = createRouteFixture();
  seedTemplate(sqlite, 14);
  const response = await request({ ...CREATE_BODY, template_id: "et_test", custom_questions_present: "1",
    custom_question_id: Array.from({ length: 4 }, (_, i) => "stage_permission_" + i),
    custom_question_enabled: ["1", "1", "1", "1"],
    custom_question_label: ["a", "b", "c", "d"],
  });
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 18);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 20);
  assert.equal(d1.stats.reads, 8);
  assert.equal(d1.stats.batches, 1);
  assert.equal(d1.stats.statements, d1.stats.reads + d1.stats.batchStatements);
  assert.ok(d1.stats.statements <= 50);
  assert.ok(d1.stats.maxBinds <= 100);
  t.diagnostic("full 18-question route D1 counters: " + JSON.stringify(d1.stats));
});

test("MIG-0652 U03: CURRENT Active-X normalization, fallback, manager links and raw alias selection", async () => {
  const cases = [
    { selectedX: null }, { selectedX: "stale" }, { selectedX: " @X_APPROVED " },
    { selectedX: "@X_APPROVED", second: "x_other" },
    { selectedX: null, manager: true },
    { selectedX: null, second: "x_other", denied: true },
    { selectedX: "stale", second: "x_other", denied: true },
  ];
  for (const item of cases) {
    const { sqlite, request } = createRouteFixture(item);
    if (item.second) addApprovedLink(sqlite, item.second);
    if (item.manager) sqlite.prepare("UPDATE x_user_account_links SET link_role = 'manager'").run();
    const response = await request();
    assert.equal(response.status, item.denied ? 400 : 200, JSON.stringify(item));
    if (item.denied) {
      assert.match((await response.json()).message, /承認済みの Active X ID/);
      assertNoCreatedRows(sqlite);
    } else assert.equal(sqlite.prepare("SELECT x_user_id FROM event_staff").get().x_user_id, "x_approved");
  }
  for (const includeTrimmed of [false, true]) {
    const { sqlite, request } = createRouteFixture({ selectedX: null, linked: false });
    addApprovedLink(sqlite, " FoO ", { name: "Space name" });
    if (includeTrimmed) addApprovedLink(sqlite, "FoO", { name: "Trimmed name" });
    const response = await request();
    assert.equal(response.status, includeTrimmed ? 200 : 400);
    if (includeTrimmed) {
      const staff = sqlite.prepare("SELECT x_user_id, display_name FROM event_staff").get();
      assert.equal(staff.x_user_id, "FoO");
      assert.equal(staff.display_name, "Trimmed name");
    } else assert.match((await response.json()).message, /紐付いた X 名義/);
  }
  // Node22's SQLite driver truncates embedded NUL on text reads. CURRENT's
  // exact owner SQL must still reject a decoded ID that is not stored exactly.
  {
    const { sqlite, d1, request } = createRouteFixture({ selectedX: null, linked: false });
    addApprovedLink(sqlite, "foo\0tail");
    const response = await request();
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /紐付いた X 名義/);
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 0);
  }
  // Keep CURRENT's decoded selection/label while witnessing their actual D1
  // type and bytes. An unchanged raw NUL-containing field is not a CAS race.
  {
    const { sqlite, request } = createRouteFixture({ selectedX: "x_approved\0tail" });
    addApprovedLink(sqlite, "x_other");
    sqlite.prepare("UPDATE x_users SET x_name = ? WHERE id = 'x_approved'").run("Approved\0tail");
    assert.equal((await request()).status, 200);
    const staff = sqlite.prepare("SELECT x_user_id, display_name, hex(display_name) AS name_hex FROM event_staff").get();
    assert.equal(staff.x_user_id, "x_approved");
    assert.equal(staff.display_name, "Approved");
    assert.equal(staff.name_hex, Buffer.from("Approved").toString("hex").toUpperCase());
    const audit = sqlite.prepare("SELECT after_json FROM audit_logs WHERE table_name = 'event_staff'").get();
    assert.equal(JSON.parse(audit.after_json).display_name, "Approved");
  }
});

test("MIG-0652 U03: unchanged chosen owner survives an additional approved link after fallback", async () => {
  const { sqlite, request } = createRouteFixture({ selectedX: null,
    beforeBatch(sqlite) { addApprovedLink(sqlite, "new_link"); },
  });
  assert.equal((await request()).status, 200);
  assert.equal(sqlite.prepare("SELECT x_user_id FROM event_staff").get().x_user_id, "x_approved");
});

test("MIG-0652 U03: real parent rejects invalid origin/session/role/BAN/ToS/CostGuard before writes", async () => {
  const cases = [
    [{}, { origin: "https://attacker.example" }, 403, "invalid_origin"],
    [{}, { cookie: null }, 401, "unauthenticated"],
    [{ expired: true }, {}, 401, "unauthenticated"],
    [{ role: "user" }, {}, 403, "forbidden"],
    [{ isBanned: 1 }, {}, 403, "banned"],
    [{ tosAccepted: 0 }, {}, 403, "tos_required"],
    [{ mode: "readonly" }, {}, 503, "maintenance_mode"],
  ];
  for (const [fixture, options, status, reason] of cases) {
    const { sqlite, d1, request } = createRouteFixture(fixture);
    const response = await request(CREATE_BODY, options);
    assert.equal(response.status, status, reason);
    assert.equal((await response.json()).reason, reason);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 0);
    if (reason === "invalid_origin") assert.equal(d1.stats.statements, 0);
  }
});

test("MIG-0652 U03: invalid transport/schema/template/owner/question inputs never write", async () => {
  const cases = [
    [{}, { ...CREATE_BODY, title: "" }, /String must contain/],
    [{}, { ...CREATE_BODY, id: "bad/id" }, /イベントID/],
    [{}, { ...CREATE_BODY, max_slots_per_video: "21" }, /20/],
    [{}, { ...CREATE_BODY, start_time: "2026-11-28T12:00", end_time: "2026-11-27T12:00" }, /start_time must not be later than end_time/],
    [{}, { ...CREATE_BODY, template_id: "missing" }, /テンプレートが見つかりません/],
    [{ status: "pending" }, CREATE_BODY, /承認済み/],
    [{ linked: false }, CREATE_BODY, /承認済み/],
    [{}, { ...CREATE_BODY, general_custom_questions_present: "1", general_custom_question_key: ["a b", "a_b"],
      general_custom_question_label: ["one", "two"] }, /識別子が重複/],
    [{}, { ...CREATE_BODY, general_custom_questions_present: "1", general_custom_question_key: ["choice"],
      general_custom_question_label: ["Choice"], general_custom_question_type: ["select"] }, /選択肢を1件/],
  ];
  for (const [options, body, message] of cases) {
    const { sqlite, d1, request } = createRouteFixture(options);
    const response = await request(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).message, message);
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 0);
  }
  for (const raw of ["{", "[]", '{"title":{}}', '{"title":["ok",1]}']) {
    const { sqlite, request } = createRouteFixture();
    assert.equal((await request(undefined, { raw })).status, 400);
    assertNoCreatedRows(sqlite);
  }
  const { sqlite, request } = createRouteFixture();
  const raw = JSON.stringify({ title: "x".repeat(65536) });
  assert.equal((await request(undefined, { raw, headers: { "content-length": "1" } })).status, 413);
  assertNoCreatedRows(sqlite);
});

test("MIG-0652 U03: duplicate ID and known rename tombstone are denied without partial effects", async () => {
  {
    const { sqlite, d1, request } = createRouteFixture();
    insert(sqlite, "events", event);
    const response = await request();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "ID「ev_create」は既に存在します。");
    assert.equal(d1.stats.batches, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  }
  {
    const { sqlite, d1, request, externalCalls } = createRouteFixture();
    seedRenameTombstone(sqlite);
    const response = await request();
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /旧URLの公開データ削除中/);
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 0);
    assert.equal(externalCalls(), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM public_visibility_fences").get().n, 1);
  }
});

function seedRenameTombstone(sqlite) {
  insert(sqlite, "public_visibility_fences", { entity_type: "event", entity_id: "ev_create",
    state: "blocked", reason: "event_id_rename_old_cleanup", fence_token: "rename-token",
    blocked_at: 100, updated_at: 100,
  });
}

test("MIG-0652 U03: owner and tombstone races roll back the entire create batch", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const changes = [
    sqlite => sqlite.prepare("UPDATE x_users SET approval_status = 'rejected'").run(),
    sqlite => sqlite.prepare("DELETE FROM x_user_account_links").run(),
    sqlite => sqlite.prepare("UPDATE x_users SET x_name = 'changed'").run(),
    sqlite => sqlite.prepare('UPDATE "user" SET active_x_user_id = NULL').run(),
    sqlite => sqlite.prepare('UPDATE "user" SET active_x_user_id = CAST(active_x_user_id AS BLOB)').run(),
    sqlite => sqlite.prepare("UPDATE x_users SET x_name = CAST(x_name AS BLOB)").run(),
    seedRenameTombstone,
  ];
  for (const beforeBatch of changes) {
    const { sqlite, d1, request } = createRouteFixture({ beforeBatch });
    const response = await request();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).ok, false);
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 1);
    assert.ok(d1.stats.batchStatements > 0, "race setup succeeded and the SQL assertion ran");
    if (beforeBatch === seedRenameTombstone) {
      assert.equal(sqlite.prepare("SELECT fence_token FROM public_visibility_fences").get().fence_token, "rename-token");
    }
  }
  for (const target of ["active", "name"]) {
    const { sqlite, d1, request } = createRouteFixture({
      selectedX: target === "active" ? "x_approved\0before" : "x_approved",
      beforeBatch(sqlite) {
        if (target === "active") sqlite.prepare('UPDATE "user" SET active_x_user_id = ?').run("x_approved\0after");
        else sqlite.prepare("UPDATE x_users SET x_name = ?").run("Approved\0after");
      },
    });
    if (target === "name") sqlite.prepare("UPDATE x_users SET x_name = ?").run("Approved\0before");
    assert.equal((await request()).status, 500, "raw bytes changed despite the same decoded prefix: " + target);
    assertNoCreatedRows(sqlite);
    assert.equal(d1.stats.batches, 1);
    assert.ok(d1.stats.batchStatements > 0);
  }
  assert.ok(logged.every(line => line === "[MIG-0652] EVENT_CREATE_FAILED"));
});

test("MIG-0652 U03: strict audit failure restores existing Queue row and exposes no provider details", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const { sqlite, d1, request } = createRouteFixture();
  insert(sqlite, "static_rebuild_queue", {
    id: "old_pending", target_type: "event_base", target_id: "ev_create", status: "pending",
    reason: "old", priority: "low", requested_by_user_id: null, created_at: 100, updated_at: 100,
  });
  const old = { ...sqlite.prepare("SELECT * FROM static_rebuild_queue").get() };
  sqlite.exec("CREATE TRIGGER reject_create_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'private-provider-secret'); END");
  const response = await request();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private-provider-secret|INSERT|audit_logs/);
  assert.equal(d1.stats.batches, 1);
  assert.deepEqual({ ...sqlite.prepare("SELECT * FROM static_rebuild_queue").get() }, old);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
  for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs"]) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  }
  assert.deepEqual(logged, ["[MIG-0652] EVENT_CREATE_FAILED"]);
});

test("MIG-0652 U03: preflight provider failure is private, redacted, and performs no batch", async (t) => {
  t.mock.method(console, "error", () => {});
  const { sqlite, d1, request } = createRouteFixture({
    beforeRead(_sqlite, sql) { if (/from "events"/i.test(sql)) throw new Error("private-provider-secret"); },
  });
  const response = await request();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(await response.text(), /private-provider-secret|SELECT|events/);
  assertNoCreatedRows(sqlite);
  assert.equal(d1.stats.batches, 0);
});

// Shared CURRENT reuse contracts and scoped manifest token-safety regressions.
// The Hono caller above still refuses every old-ID tombstone. Remaining unsafe
// legacy outcomes are characterized separately, never permission to enable it.
const REUSE_TOMBSTONE = {
  fence_token: "reuse-token", state: "blocked",
  reason: "event_id_rename_old_cleanup", blocked_at: now - 86400,
};
const REUSE_ENTRY = {
  entity_type: "event", entity_id: "ev_create", fence_token: REUSE_TOMBSTONE.fence_token,
  reason: REUSE_TOMBSTONE.reason, blocked_at: REUSE_TOMBSTONE.blocked_at,
};
const REUSE_OTHER = { entity_type: "video", entity_id: "other", fence_token: "other-token", blocked_at: 1, reason: null };
const REUSE_KEYS = [
  "events/ev_create.json", "events/ev_create/base.v1.json", "events/ev_create/slots.v1.json",
  "events/ev_create/release.v1.json", "events/ev_create/playlist.v1.json",
];

/** Reuse the migrated SQLite harness and the actual shared manifest R2 codec. */
function createReuseFixture({ entries = [REUSE_ENTRY, REUSE_OTHER], beforeRead } = {}) {
  const timeline = [];
  const harness = createAtomicCreateHarness({ beforeRead(sqlite, sql, count) {
    timeline.push(sql.includes('"static_rebuild_queue"') ? "d1:cleanup" : "d1:artifacts");
    beforeRead?.(sqlite, sql, count);
  } });
  for (const [index, target] of eventIdRenameCleanupTargets("ev_create").entries()) {
    insert(harness.sqlite, "static_rebuild_queue", {
      id: "reuse_cleanup_" + index, target_type: target.targetType, target_id: target.targetId,
      reason: REUSE_TOMBSTONE.reason, status: "done", created_at: now - 1, updated_at: now - 1,
    });
  }
  insert(harness.sqlite, "public_visibility_fences", {
    ...REUSE_TOMBSTONE, entity_type: "event", entity_id: "ev_create", updated_at: now - 86400,
  });
  let stored = { schema_version: 1, revision: 1, generated_at: now, entities: structuredClone(entries) };
  let etag = "v1";
  let version = 1;
  const objects = new Set();
  const bucket = {
    async head(key) { timeline.push("head:" + key); return objects.has(key) ? { key } : null; },
    async get(key) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      timeline.push("r2:get");
      if (stored === null) return null;
      const body = JSON.stringify(stored);
      return { etag, size: Buffer.byteLength(body), text: async () => { timeline.push("r2:text"); return body; } };
    },
    async put(key, body, options) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      assert.equal(options?.httpMetadata?.cacheControl, "no-store");
      timeline.push("r2:put");
      if (options.onlyIf instanceof Headers) {
        assert.equal(options.onlyIf.get("If-None-Match"), "*");
        if (stored !== null) return null;
      } else {
        assert.equal(typeof options.onlyIf?.etagMatches, "string", "reuse never makes an unconditional PUT");
        if (options.onlyIf.etagMatches !== etag) return null;
      }
      stored = JSON.parse(body);
      etag = "v" + ++version;
      return { etag };
    },
  };
  const host = {
    requireBucket() { timeline.push("host:bucket"); return bucket; },
    readManifest(candidate) {
      assert.equal(candidate, bucket);
      timeline.push("host:read");
      return readVisibilityManifestObject(candidate);
    },
    writeManifest(manifest, options) {
      assert.equal(options.bucket, bucket);
      timeline.push("host:write");
      return putVisibilityManifestWithCas(options.bucket, manifest, options.ifMatchEtag);
    },
  };
  return {
    ...harness, bucket, host, timeline, objects,
    prepare: (overrides = {}) => preCommitEventIdReuse({
      db: harness.db, eventId: "ev_create", tombstone: REUSE_TOMBSTONE, now, ...overrides,
    }, host),
    manifest: () => structuredClone(stored),
    replaceEntries(value) {
      stored = value === null ? null : { schema_version: 1, revision: ++version, generated_at: now, entities: structuredClone(value) };
      etag = stored === null ? null : "v" + version;
    },
  };
}

function assertReuseDidNotMutateD1(fixture) {
  assert.equal(fixture.d1.stats.batches, 0);
  assert.equal(fixture.sqlite.prepare("SELECT fence_token FROM public_visibility_fences").get().fence_token, "reuse-token");
  for (const table of ["events", "event_staff", "event_custom_questions", "audit_logs"]) {
    assert.equal(fixture.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  }
}

test("MIG-0652 reuse extraction: exact lazy D1/HEAD/manifest order, receipt and compensation", async () => {
  const f = createReuseFixture();
  const result = await f.prepare();
  assert.deepEqual(result, { ok: true, precommit: {
    eventId: "ev_create", fenceToken: "reuse-token", previousEntry: REUSE_ENTRY,
  } });
  assert.deepEqual(f.timeline, [
    "d1:cleanup", "d1:artifacts", "host:bucket", ...REUSE_KEYS.map(key => "head:" + key),
    "host:read", "r2:get", "r2:text", "host:write", "r2:put", "host:read", "r2:get", "r2:text",
  ]);
  assert.equal(f.d1.stats.reads, 2);
  assert.deepEqual(f.manifest().entities, [REUSE_OTHER]);
  assertReuseDidNotMutateD1(f);
  f.timeline.length = 0;
  await compensateEventIdReuseOnD1Failure(result.precommit, f.host);
  assert.deepEqual(f.timeline, ["host:bucket", "host:read", "r2:get", "r2:text", "host:write", "r2:put"]);
  assert.deepEqual(f.manifest().entities, [REUSE_OTHER, REUSE_ENTRY]);
  assertReuseDidNotMutateD1(f);
});

test("MIG-0652 reuse extraction: validation and D1 denials do not resolve the bucket", async () => {
  const cases = [
    { tombstone: { ...REUSE_TOMBSTONE, state: "release_pending" }, reads: 0, reason: "event_id_reuse_fence_state_invalid" },
    { tombstone: { ...REUSE_TOMBSTONE, blocked_at: now - 86399 }, reads: 0, reason: "event_id_reuse_retention_active" },
    { tombstone: { ...REUSE_TOMBSTONE, blocked_at: null }, reads: 0, reason: "event_id_reuse_retention_active" },
    { setup: sqlite => sqlite.prepare("DELETE FROM static_rebuild_queue WHERE id = 'reuse_cleanup_0'").run(), reads: 1, reason: "event_id_reuse_cleanup_pending" },
    { setup: sqlite => insert(sqlite, "static_rebuild_queue", {
      id: "same_second_pending", target_type: "event", target_id: "ev_create", reason: REUSE_TOMBSTONE.reason,
      status: "pending", created_at: now - 1, updated_at: now - 1,
    }), reads: 1, reason: "event_id_reuse_cleanup_pending" },
    { setup: sqlite => insert(sqlite, "static_artifacts", {
      id: "still_live", target_type: "event_playlist", target_id: "ev_create", object_key: REUSE_KEYS[4],
      content_hash: "old", schema_version: 1, generated_at: now - 1,
    }), reads: 2, reason: "event_id_reuse_artifact_tracking_pending" },
  ];
  for (const item of cases) {
    const f = createReuseFixture();
    item.setup?.(f.sqlite);
    assert.deepEqual(await f.prepare(item.tombstone ? { tombstone: item.tombstone } : {}), { ok: false, reason: item.reason });
    assert.equal(f.d1.stats.reads, item.reads);
    assert.ok(f.timeline.every(op => op.startsWith("d1:")));
    assertReuseDidNotMutateD1(f);
  }
  for (const table of ["static_rebuild_queue", "static_artifacts"]) {
    const failure = new Error("injected read failure");
    const f = createReuseFixture({ beforeRead(_sqlite, sql) { if (sql.includes('"' + table + '"')) throw failure; } });
    await assert.rejects(f.prepare(), error => error.cause === failure, "CURRENT Drizzle D1 failure escapes, unlike storage notReady results");
    assert.ok(f.timeline.every(op => op.startsWith("d1:")));
    assertReuseDidNotMutateD1(f);
  }
});

test("MIG-0652 reuse extraction: all five canonical objects use HEAD and block reuse", async () => {
  for (const key of REUSE_KEYS) {
    const f = createReuseFixture();
    f.objects.add(key);
    assert.deepEqual(await f.prepare(), { ok: false, reason: "event_id_reuse_r2_cleanup_pending" });
    assert.deepEqual(f.timeline.slice(3), REUSE_KEYS.map(value => "head:" + value));
    assertReuseDidNotMutateD1(f);
  }
  for (const operation of ["requireBucket", "head", "get"]) {
    const f = createReuseFixture();
    (operation === "requireBucket" ? f.host : f.bucket)[operation] = () => { throw new Error("injected storage failure"); };
    assert.deepEqual(await f.prepare(), { ok: false, reason: operation === "get"
      ? "event_id_reuse_manifest_unavailable" : "event_id_reuse_storage_unavailable" });
    assertReuseDidNotMutateD1(f);
  }
});

test("MIG-0652 reuse extraction: missing ETag and failed CAS preserve the manifest", async () => {
  const noEtag = createReuseFixture();
  const read = noEtag.host.readManifest;
  noEtag.host.readManifest = async bucket => ({ ...await read(bucket), etag: null });
  assert.deepEqual(await noEtag.prepare(), { ok: false, reason: "event_id_reuse_manifest_cas_unavailable" });
  assert.ok(!noEtag.timeline.includes("host:write"));
  const lostCas = createReuseFixture();
  let puts = 0;
  lostCas.bucket.put = async () => { puts++; return null; };
  assert.deepEqual(await lostCas.prepare(), { ok: false, reason: "event_id_reuse_manifest_release_failed" });
  assert.equal(puts, 3, "actual shared manifest codec retries the same conditional write three times");
  assert.deepEqual(lostCas.manifest().entities, [REUSE_ENTRY, REUSE_OTHER]);
  for (const fixture of [noEtag, lostCas]) assertReuseDidNotMutateD1(fixture);
});

test("MIG-0652 reuse extraction: compensation stays lazy and forwards the host wrappers unchanged", async () => {
  const f = createReuseFixture({ entries: [] });
  f.replaceEntries(null);
  const result = await f.prepare();
  assert.deepEqual(result, { ok: true, precommit: { eventId: "ev_create", fenceToken: "reuse-token", previousEntry: null } });
  let calls = 0;
  await compensateEventIdReuseOnD1Failure(result.precommit, {
    requireBucket() { calls++; throw new Error("must remain lazy"); },
    readManifest() { calls++; throw new Error("must remain lazy"); },
    writeManifest() { calls++; throw new Error("must remain lazy"); },
  });
  assert.equal(calls, 0);
  for (const bucket of [undefined, null]) {
    const trace = [];
    await compensateEventIdReuseOnD1Failure({ ...result.precommit, previousEntry: REUSE_ENTRY }, {
      requireBucket() { trace.push("bucket"); return bucket; },
      async readManifest(received) {
        assert.equal(received, bucket, "CURRENT wrapper, not a new core policy, handles missing bindings");
        trace.push("read");
        return { manifest: { schema_version: 1, revision: 0, generated_at: now, entities: [] }, etag: null };
      },
      async writeManifest(_manifest, options) {
        assert.equal(options.bucket, bucket);
        assert.equal(options.ifMatchEtag, null);
        trace.push("write");
        throw new Error("injected wrapper failure");
      },
    });
    assert.deepEqual(trace, ["bucket", "read", "write", "read", "write", "read", "write"]);
  }
});

test("MIG-0652 reuse token ownership: any foreign token denies release regardless of entry order", async () => {
  const foreign = { ...REUSE_ENTRY, fence_token: "foreign" };
  for (const entries of [
    [foreign, REUSE_OTHER],
    [REUSE_ENTRY, foreign, REUSE_OTHER],
    [foreign, REUSE_ENTRY, REUSE_OTHER],
    [REUSE_ENTRY, REUSE_OTHER, REUSE_ENTRY, foreign],
  ]) {
    const f = createReuseFixture({ entries });
    const before = f.manifest();
    assert.deepEqual(await f.prepare(), { ok: false, reason: "event_id_reuse_fence_token_mismatch" });
    assert.deepEqual(f.manifest(), before, "denial preserves every block and the manifest revision");
    assert.ok(!f.timeline.includes("host:write"));
    assert.ok(!f.timeline.includes("r2:put"));
    assert.equal(f.d1.stats.reads, 2);
    assertReuseDidNotMutateD1(f);
  }
});

test("MIG-0652 reuse token ownership: same-token duplicates release while unrelated IDs and types stay blocked", async () => {
  const otherEvent = { ...REUSE_ENTRY, entity_id: "ev_other", fence_token: "other-event-token" };
  const sameIdVideo = { ...REUSE_OTHER, entity_id: "ev_create" };
  const duplicate = { ...REUSE_ENTRY, reason: "same-token-duplicate", blocked_at: REUSE_ENTRY.blocked_at + 1 };
  const unrelated = [otherEvent, sameIdVideo, REUSE_OTHER];
  for (const entries of [
    [otherEvent, REUSE_ENTRY, sameIdVideo, duplicate, REUSE_OTHER],
    unrelated,
  ]) {
    const f = createReuseFixture({ entries });
    const previousEntry = entries.includes(REUSE_ENTRY) ? REUSE_ENTRY : null;
    assert.deepEqual(await f.prepare(), { ok: true, precommit: {
      eventId: "ev_create", fenceToken: "reuse-token", previousEntry,
    } });
    assert.deepEqual(f.manifest().entities, unrelated);
    assert.equal(f.timeline.filter(op => op === "r2:put").length, previousEntry ? 1 : 0);
    assert.equal(f.d1.stats.reads, 2);
    assertReuseDidNotMutateD1(f);
  }
});

test("MIG-0652 reuse token ownership: post-PUT confirmation rejects every remaining same-event block", async () => {
  for (const fence_token of ["reuse-token", "new-owner"]) {
    const remaining = { ...REUSE_ENTRY, fence_token };
    const f = createReuseFixture();
    const put = f.bucket.put;
    f.bucket.put = async (...args) => {
      const result = await put(...args);
      f.replaceEntries([REUSE_OTHER, remaining]);
      return result;
    };
    assert.deepEqual(await f.prepare(), { ok: false, reason: "event_id_reuse_manifest_release_unconfirmed" });
    assert.deepEqual(f.manifest().entities, [REUSE_OTHER, remaining]);
    assert.equal(f.timeline.filter(op => op === "r2:put").length, 1);
    assert.equal(f.timeline.filter(op => op === "host:read").length, 2);
    assert.equal(f.d1.stats.reads, 2);
    assertReuseDidNotMutateD1(f);
  }
});

test("MIG-0652 reuse CURRENT characterization: partial PUT failure still returns no compensation receipt", async () => {
  const partial = createReuseFixture();
  const get = partial.bucket.get;
  let reads = 0;
  partial.bucket.get = async key => { if (++reads === 2) throw new Error("lost confirmation"); return get(key); };
  assert.deepEqual(await partial.prepare(), { ok: false, reason: "event_id_reuse_manifest_release_failed" });
  assert.deepEqual(partial.manifest().entities, [REUSE_OTHER], "KNOWN CURRENT: removed entry has no returned compensation receipt");
  assertReuseDidNotMutateD1(partial);
});

test("MIG-0652 reuse compensation: a foreign block appearing after release is preserved", async () => {
  const foreign = { ...REUSE_ENTRY, fence_token: "new-owner" };
  const raced = createReuseFixture();
  const result = await raced.prepare();
  assert.equal(result.ok, true);
  raced.replaceEntries([REUSE_OTHER, foreign]);
  raced.timeline.length = 0;
  await compensateEventIdReuseOnD1Failure(result.precommit, raced.host);
  assert.deepEqual(raced.timeline, ["host:bucket", "host:read", "r2:get", "r2:text"]);
  assert.deepEqual(raced.manifest().entities, [REUSE_OTHER, foreign]);
  assertReuseDidNotMutateD1(raced);
});

test("MIG-0652 reuse CURRENT characterization: prior-cycle cleanup is accepted without a tombstone generation filter", async () => {
  const f = createReuseFixture();
  f.sqlite.prepare("UPDATE static_rebuild_queue SET updated_at = ?").run(now - 172800);
  assert.equal((await f.prepare()).ok, true, "CURRENT checks latest target status, not the tombstone generation");
  assertReuseDidNotMutateD1(f);
});

test("MIG-0652 reuse CURRENT characterization: failed creator compensation can restore an old block after another creator", async () => {
  const f = createReuseFixture();
  const first = await f.prepare();
  const second = await f.prepare();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.precommit.previousEntry, null);
  // Model the other creator's completed D1 ownership change. The extracted
  // precommit/compensator itself never commits D1 and cannot inspect a winner.
  f.sqlite.prepare("DELETE FROM public_visibility_fences WHERE fence_token = ?").run("reuse-token");
  insert(f.sqlite, "events", event);
  const reads = f.d1.stats.reads;
  await compensateEventIdReuseOnD1Failure(first.precommit, f.host);
  assert.equal(f.d1.stats.reads, reads, "CURRENT compensation has no D1 dependency");
  assert.deepEqual(f.manifest().entities, [REUSE_OTHER, REUSE_ENTRY], "KNOWN CURRENT availability defect; not safe reuse acceptance");
  assert.equal(f.sqlite.prepare("SELECT id FROM events").get().id, "ev_create");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM public_visibility_fences").get().n, 0);
});

test("MIG-0652 update permissions: only the exact admin role bypasses D1", async () => {
  const admin = createAtomicCreateHarness({ beforeRead() { throw new Error("admin must not read D1"); } });
  assert.deepEqual(await resolveEventEditPermissions(admin.db, { id: "u_admin", role: "admin" }, "ev_create"),
    { basic: true, publish: true, questions: true, slots: true });
  assert.equal(admin.d1.stats.statements, 0);
  assert.equal(admin.d1.stats.batches, 0);
  for (const role of ["Admin", "admin ", "moderator", "user", null, undefined]) {
    const f = createAtomicCreateHarness();
    assert.deepEqual(await resolveEventEditPermissions(f.db, { id: "u_admin", role }, "ev_create"),
      { basic: false, publish: false, questions: false, slots: false }, String(role));
    assert.equal(f.d1.stats.reads, 1);
    assert.equal(f.d1.stats.batches, 0);
  }
});

test("MIG-0652 update permissions: approved owner and manager links union only this event's staff grants", async () => {
  const f = createAtomicCreateHarness({ beforeRead(_sqlite, sql) { assert.match(sql, /^select\b/i); } });
  seedCreateActor(f.sqlite, { selectedX: "x_rejected" });
  addApprovedLink(f.sqlite, "x_manager", { role: "manager" });
  addApprovedLink(f.sqlite, "x_rejected", { status: "rejected" });
  insert(f.sqlite, "x_users", { id: "x_unlinked", x_name: "Unlinked", approval_status: "approved" });
  const grants = [
    { x_user_id: "x_approved", permission_preset: "custom", custom_permission_keys_json: '["event.basic"]' },
    { x_user_id: "x_manager", permission_preset: "custom", custom_permission_keys_json: '["event.publish","event.questions"]' },
    { x_user_id: "x_rejected" },
    { x_user_id: "x_unlinked" },
    { x_user_id: "x_approved", event_id: "ev_other" },
  ];
  for (const [index, grant] of grants.entries()) {
    insert(f.sqlite, "event_staff", { ...owner, id: "grant_" + index, ...grant });
  }
  const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  assert.deepEqual(await resolveEventEditPermissions(f.db, { id: "u_admin", role: "user" }, "ev_create"),
    { basic: true, publish: true, questions: true, slots: false });
  assert.equal(f.d1.stats.reads, 2);
  assert.equal(f.d1.stats.batches, 0);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changes);
});

test("MIG-0652 update permissions: approval, linkage, membership and staff presets retain CURRENT denials", async () => {
  const denied = { basic: false, publish: false, questions: false, slots: false };
  const cases = [
    { name: "unlinked approved X", actor: { linked: false }, reads: 1 },
    { name: "another actor's link", actor: { linkActor: "u_other" }, reads: 1 },
    ...["pending", "rejected", "imported"].map(status => ({ name: status, actor: { status }, reads: 1 })),
    { name: "no staff row", staff: null, reads: 2 },
    { name: "other event", staff: { event_id: "ev_other" }, reads: 2 },
    { name: "malformed custom grants", staff: { permission_preset: "custom", custom_permission_keys_json: "{" }, reads: 2 },
    { name: "slot manager", staff: { permission_preset: "slot_manager" }, reads: 2, expected: { ...denied, slots: true } },
    { name: "owner", reads: 2, expected: { basic: true, publish: true, questions: true, slots: true } },
  ];
  for (const item of cases) {
    const f = createAtomicCreateHarness({ beforeRead(_sqlite, sql) { assert.match(sql, /^select\b/i); } });
    seedCreateActor(f.sqlite, item.actor);
    if (item.staff !== null) insert(f.sqlite, "event_staff", { ...owner, ...item.staff });
    const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
    assert.deepEqual(await resolveEventEditPermissions(f.db, { id: "u_admin", role: "user" }, "ev_create"),
      item.expected ?? denied, item.name);
    assert.equal(f.d1.stats.reads, item.reads, item.name);
    assert.equal(f.d1.stats.batches, 0, item.name);
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changes, item.name);
  }
});

test("MIG-0652 update permissions: approved-link and staff D1 failures propagate without grants or writes", async () => {
  for (const failAt of [1, 2]) {
    const failure = new Error("injected permission read failure");
    const f = createAtomicCreateHarness({ beforeRead(_sqlite, sql, count) {
      assert.match(sql, /^select\b/i);
      if (count === failAt) throw failure;
    } });
    seedCreateActor(f.sqlite);
    insert(f.sqlite, "event_staff", owner);
    const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
    await assert.rejects(
      resolveEventEditPermissions(f.db, { id: "u_admin", role: "user" }, "ev_create"),
      error => error.cause === failure,
    );
    assert.equal(f.d1.stats.reads, failAt);
    assert.equal(f.d1.stats.batches, 0);
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changes);
  }
});

const UPDATE_SECTIONS = ["basic", "publish", "questions", "slots"];
const UPDATE_DATA = Object.freeze({
  title: " Revised event ", event_type: "collabo", explanation: "Updated explanation",
  youtube_description_template: "New template", icon_url: "https://example.test/icon.png",
  img_url: "https://example.test/banner.png", accent_color: "#123456",
  start_time: "2026-11-08T12:34", end_time: "2026-11-08T15:00:30",
  visibility_status: "public", entry_start_time: "2026-11-01T09:00", entry_end_time: "2026-11-07T23:59",
  allow_user_video_event_links: 1, allow_unslotted_posts: 1, allow_user_video_edits: 1,
  user_video_edit_permission_keys_json: '["video.basics"]', editable_fields: '["title"]', review_settings: '{"next":true}',
  max_slots_per_video: 4, max_slot_reservation_groups_per_xid: 3, slot_interval_minutes: 15,
  slot_part_gap_minutes: 5, slot_type: "count", slot_visibility_mode: "anonymous", parts_text: " Opening \nOpening\r\nFinale ",
});
const UPDATE_BEFORE = Object.freeze({ ...event, updated_at: now - 1, youtube_description_template: "Previous template",
  required_video_fields_json: '["music"]', editable_fields: '["description"]', review_settings: '{"old":true}',
});
const UPDATE_EXPECTED_SECTIONS = {
  basic: {
    title: " Revised event ", event_type: "collabo", explanation: "Updated explanation",
    youtube_description_template: "New template", icon_url: "https://example.test/icon.png",
    img_url: "https://example.test/banner.png", accent_color: "#123456",
    start_time: Date.parse("2026-11-08T03:34:00Z") / 1000, end_time: Date.parse("2026-11-08T06:00:30Z") / 1000,
  },
  publish: {
    visibility_status: "public", entry_start_time: Date.parse("2026-11-01T00:00:00Z") / 1000,
    entry_end_time: Date.parse("2026-11-07T14:59:00Z") / 1000, allow_user_video_event_links: 1, allow_unslotted_posts: 1,
  },
  questions: {
    allow_user_video_edits: 1, user_video_edit_permission_keys_json: '["video.basics"]',
    required_video_fields_json: '["icon_url"]', editable_fields: '["title"]', review_settings: '{"next":true}',
  },
  slots: {
    max_slots_per_video: 4, max_slot_reservation_groups_per_xid: 3, slot_interval_minutes: 15,
    slot_part_gap_minutes: 5, slot_type: "count", slot_visibility_mode: "anonymous", parts_json: '["Opening","Finale"]',
  },
};

test("MIG-0652 update payload: all 16 permission masks preserve fields, ordering and gated form reads", () => {
  for (let mask = 0; mask < 16; mask++) {
    const permissions = Object.freeze(Object.fromEntries(UPDATE_SECTIONS.map((section, index) => [section, Boolean(mask & (1 << index))])));
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      youtube_description_template: "New template", required_video_fields_present: "1", required_video_fields_json: '["icon_url"]',
      custom_questions_present: "1", custom_question_id: "stage_permission_alpha", custom_question_enabled: "1",
      custom_question_required: "1", custom_question_label: " Updated stage ",
      custom_question_description: " Requirements ", custom_question_placeholder: " answer ",
    })) formData.append(key, value);
    const formBefore = [...formData];
    const dataBefore = structuredClone(UPDATE_DATA);
    const before = structuredClone(UPDATE_BEFORE);
    const reads = [];
    for (const method of ["get", "getAll", "has"]) {
      const original = formData[method].bind(formData);
      formData[method] = key => { reads.push(method + ":" + key); return original(key); };
    }
    const actual = buildEventUpdatePayload({ data: UPDATE_DATA, before: UPDATE_BEFORE, formData, permissions, now });
    const sections = UPDATE_SECTIONS.filter(section => permissions[section]);
    const payload = { updated_at: now };
    for (const section of sections) Object.assign(payload, UPDATE_EXPECTED_SECTIONS[section]);
    assert.deepEqual(actual, {
      payload, updatedSections: sections,
      changedByPermission: Object.fromEntries(sections.map(section => [section, "event." + section])),
      videoFormSettingsJson: permissions.questions ? JSON.stringify({ stage_permissions: [{
        id: "stage_permission_alpha", enabled: true, required: true, label: "Updated stage",
        description: "Requirements", placeholder: "answer",
      }] }) : null,
    }, "permission mask " + mask);
    assert.deepEqual(Object.keys(actual), ["payload", "updatedSections", "changedByPermission", "videoFormSettingsJson"]);
    assert.deepEqual(Object.keys(actual.payload), Object.keys(payload));
    assert.deepEqual(Object.keys(actual.changedByPermission), sections);
    assert.deepEqual(reads, [
      ...(permissions.basic ? ["has:youtube_description_template"] : []),
      ...(permissions.questions ? [
        "getAll:custom_question_id", "getAll:custom_question_enabled", "getAll:custom_question_required",
        "getAll:custom_question_label", "getAll:custom_question_description", "getAll:custom_question_placeholder",
        "get:custom_questions_present", "get:required_video_fields_present", "has:required_video_fields_json", "get:required_video_fields_json",
      ] : []),
    ], "stage serializer runs before required-fields serializer, only for an allowed questions section");
    assert.deepEqual([...formData], formBefore);
    assert.deepEqual(UPDATE_DATA, dataBefore);
    assert.deepEqual(UPDATE_BEFORE, before);
  }
});

test("MIG-0652 update payload: omitted and explicit-clear controls preserve CURRENT null and fallback semantics", () => {
  const cases = [
    { name: "omitted controls", controls: [], template: "ignored", expected: ["Previous template", '["music"]', '["description"]', '{"old":true}'] },
    { name: "explicit clear", controls: [["youtube_description_template", ""], ["required_video_fields_present", "1"], ["required_video_fields_json", "[]"]],
      template: null, editable: "", review: "", expected: [null, null, "", ""] },
    { name: "present undefined template", controls: [["youtube_description_template", ""]],
      expected: [null, '["music"]', '["description"]', '{"old":true}'] },
    { name: "noncanonical presence flag", controls: [["required_video_fields_present", "true"], ["required_video_fields_json", "[]"]],
      expected: ["Previous template", '["music"]', '["description"]', '{"old":true}'] },
    { name: "checkbox values", controls: [["required_video_fields_present", "1"], ["required_video_fields", "icon_url"]],
      expected: ["Previous template", '["icon_url"]', '["description"]', '{"old":true}'] },
    { name: "nullable previous fields", controls: [], previous: null, expected: [null, null, null, null] },
  ];
  for (const item of cases) {
    const formData = new FormData();
    for (const [key, value] of item.controls) formData.append(key, value);
    const before = item.previous === null ? { ...UPDATE_BEFORE, youtube_description_template: null,
      required_video_fields_json: null, editable_fields: null, review_settings: null } : UPDATE_BEFORE;
    const actual = buildEventUpdatePayload({
      data: { ...UPDATE_DATA, youtube_description_template: item.template, editable_fields: item.editable, review_settings: item.review ?? null },
      before, formData, permissions: { basic: true, publish: false, questions: true, slots: false }, now,
    });
    assert.deepEqual([actual.payload.youtube_description_template, actual.payload.required_video_fields_json,
      actual.payload.editable_fields, actual.payload.review_settings], item.expected, item.name);
    assert.equal(actual.videoFormSettingsJson, '{"stage_permissions":[]}', "questions permission keeps stage reconciliation enabled: " + item.name);
  }
});

test("MIG-0652 update payload: publish normalization and empty slot inputs remain permission-gated", () => {
  const formData = new FormData();
  for (const method of ["get", "getAll", "has"]) formData[method] = () => { throw new Error("denied sections must not inspect controls"); };
  const actual = buildEventUpdatePayload({
    data: { ...UPDATE_DATA, visibility_status: "archived", entry_start_time: "not-a-date", entry_end_time: "",
      slot_interval_minutes: undefined, parts_text: "\n \r\n" },
    before: UPDATE_BEFORE, formData, permissions: { basic: false, publish: true, questions: false, slots: true }, now,
  });
  assert.deepEqual(actual, {
    payload: { updated_at: now, ...UPDATE_EXPECTED_SECTIONS.publish, visibility_status: "private", entry_start_time: null, entry_end_time: null,
      ...UPDATE_EXPECTED_SECTIONS.slots, slot_interval_minutes: null, parts_json: null },
    updatedSections: ["publish", "slots"], changedByPermission: { publish: "event.publish", slots: "event.slots" }, videoFormSettingsJson: null,
  });
});

test("MIG-0652 update payload: CURRENT runtime exports and admin section constants keep canonical identity", () => {
  assert.deepEqual(Object.keys(currentEventPayload).sort(), ["buildEventUpdatePayload", "parseDateInput"]);
  assert.equal(currentEventPayload.buildEventUpdatePayload, buildEventUpdatePayload);
  assert.equal(currentEventPayload.parseDateInput, parseDateInput);
  assert.deepEqual(Object.keys(currentEventSections).sort(), ["EVENT_SECTION_PERMISSION_KEYS", "snapshotEventSection"]);
  assert.equal(currentEventSections.EVENT_SECTION_PERMISSION_KEYS, EVENT_SECTION_PERMISSION_KEYS);
  assert.deepEqual(EVENT_SECTION_PERMISSION_KEYS, { basic: "event.basic", publish: "event.publish", questions: "event.questions", slots: "event.slots" });
});

const makeStageQuestionDiffRow = (key, extra = {}) => ({
  id: "old-" + key, question_key: key, label: key, description: null,
  type: "textarea", required: 0, options_json: null, placeholder: null,
  max_length: 1000, sort_order: 0, is_active: 1, visibility: "review",
  updated_at: 50, ...extra,
});
test("MIG-0652 U03f: pure stage diff retains matching definitions without mutations", async () => {
  const { planStageQuestionDiff } = await import("@flamenode/server-core/event/updatePayload");
  const oldRows = [makeStageQuestionDiffRow("a"), makeStageQuestionDiffRow("b")];
  const nextRows = [makeStageQuestionDiffRow("a", { id: "new-a" }), makeStageQuestionDiffRow("b", { id: "new-b" })];
  assert.deepEqual(planStageQuestionDiff(oldRows, nextRows),
    { ok: true, obsolete: [], changed: [], inserted: [] });
  assert.equal(oldRows[0].id, "old-a");
  assert.equal(nextRows[0].id, "new-a");
});
test("MIG-0652 U03f: pure stage diff orders deletions/changes by old and inserts by next", async () => {
  const { planStageQuestionDiff } = await import("@flamenode/server-core/event/updatePayload");
  const oldRows = ["old1", "changed1", "old2", "changed2", "same"].map(k => makeStageQuestionDiffRow(k));
  const newRows = [makeStageQuestionDiffRow("new2"), makeStageQuestionDiffRow("changed2", { required: 1 }),
    makeStageQuestionDiffRow("same"), makeStageQuestionDiffRow("new1"), makeStageQuestionDiffRow("changed1", { label: "new" })];
  const result = planStageQuestionDiff(oldRows, newRows);
  assert.equal(result.ok, true);
  assert.deepEqual(result.obsolete.map(x => x.question_key), ["old1", "old2"]);
  assert.deepEqual(result.changed.map(x => x.before.question_key), ["changed1", "changed2"]);
  assert.deepEqual(result.inserted.map(x => x.question_key), ["new2", "new1"]);
});
test("MIG-0652 U03f: exact eleven-field CURRENT stage comparison ignores only identity/timestamps", async () => {
  const { planStageQuestionDiff } = await import("@flamenode/server-core/event/updatePayload");
  for (const key of ["question_key", "label", "description", "type", "required",
    "options_json", "placeholder", "max_length", "sort_order", "is_active", "visibility"]) {
    const before = makeStageQuestionDiffRow("same");
    const after = makeStageQuestionDiffRow("same", { [key]: key === "question_key" ? "different" : "different" });
    const result = planStageQuestionDiff([before], [after]);
    assert.equal(result.ok, true, key);
    if (key === "question_key") {
      assert.equal(result.obsolete.length, 1);
      assert.equal(result.inserted.length, 1);
    } else assert.equal(result.changed.length, 1, key);
  }
  assert.deepEqual(planStageQuestionDiff([makeStageQuestionDiffRow("a")],
    [makeStageQuestionDiffRow("a", { id: "other", updated_at: 99 })]),
    { ok: true, obsolete: [], changed: [], inserted: [] });
});
test("MIG-0652 U03f: duplicate stage keys fail closed", async () => {
  const { planStageQuestionDiff } = await import("@flamenode/server-core/event/updatePayload");
  assert.deepEqual(planStageQuestionDiff([makeStageQuestionDiffRow("a"), makeStageQuestionDiffRow("a")], []),
    { ok: false, reason: "duplicate_existing_key" });
  assert.deepEqual(planStageQuestionDiff([], [makeStageQuestionDiffRow("a"), makeStageQuestionDiffRow("a")]),
    { ok: false, reason: "duplicate_next_key" });
});

test("MIG-0652 U03f: stage diff matches frozen CURRENT Map/filter algorithm across 512 distinct-key scenarios", async () => {
  const { planStageQuestionDiff } = await import("@flamenode/server-core/event/updatePayload");
  // CURRENT's stage block iterates obsolete rows in existing order, then changed
  // rows in existing order, and finally inserts in submitted order.
  const keys = ["a", "b", "c", "d", "e"];
  const variants = [null, "label", "required", "sort_order", "description", "visibility", "updated_at"];
  const sameDefinition = (a, b) => [
    "question_key", "label", "description", "type", "required",
    "options_json", "placeholder", "max_length", "sort_order", "is_active", "visibility",
  ].every(k => a[k] === b[k]);
  const makeExpected = (existing, next) => {
    const nextByKey = new Map(next.map(x => [x.question_key, x]));
    const obsolete = existing.filter(x => !nextByKey.has(x.question_key));
    const changed = [];
    for (const row of existing) {
      const replacement = nextByKey.get(row.question_key);
      if (!replacement) continue;
      nextByKey.delete(row.question_key);
      if (!sameDefinition(row, replacement)) changed.push({ before: row, replacement });
    }
    return { ok: true, obsolete, changed, inserted: [...nextByKey.values()] };
  };
  for (let mask = 0; mask < 512; mask++) {
    const existing = keys.filter((_k, i) => ((mask >> i) & 1) !== 0)
      .map((key, i) => makeStageQuestionDiffRow(key, { sort_order: i }));
    const next = [...keys].reverse().filter((_k, i) => ((mask >> (5 + i)) & 1) !== 0 || i === (mask % 5))
      .map((key, i) => {
        const field = variants[(mask + i) % variants.length];
        const overrides = { id: "new-" + key, updated_at: 100 + i };
        if (field === "label") overrides.label = "new label";
        if (field === "required") overrides.required = 1;
        if (field === "sort_order") overrides.sort_order = 100 + i;
        if (field === "description") overrides.description = "new description";
        if (field === "visibility") overrides.visibility = "public";
        return makeStageQuestionDiffRow(key, overrides);
      });
    assert.deepEqual(planStageQuestionDiff(existing, next), makeExpected(existing, next), "mask " + mask);
  }
});

test("MIG-0652 U03g: no-op stage reconciliation produces zero D1 mutations", async () => {
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  const existing = [makeStageQuestionDiffRow("a")];
  const next = [makeStageQuestionDiffRow("a", { id: "new-a" })];
  assert.deepEqual(planStageQuestionMutationSteps({ existing, next, deletedAnswers: [] }),
    { ok: true, operations: [], expectedMutationChanges: [], obsoleteIds: [] });
});
test("MIG-0652 U03g/U03m: stage CAS ordering within canonical four-question cap", async () => {
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  const existing = ["delete2", "update2", "delete1", "update1"].map(makeStageQuestionDiffRow);
  const next = [makeStageQuestionDiffRow("update1", { required: 1 }),
    ...Array.from({ length: 2 }, (_, index) => makeStageQuestionDiffRow("new" + index)),
    makeStageQuestionDiffRow("update2", { label: "changed" })];
  const answers = [
    { question_id: "old-delete2", video_id: "v2" },
    { question_id: "old-delete1", video_id: "v1" },
  ];
  const result = planStageQuestionMutationSteps({ existing, next, deletedAnswers: answers });
  assert.equal(result.ok, true);
  assert.deepEqual(result.operations.map(step => step.kind), [
    "delete_answers", "delete_questions", "update_question", "update_question", "insert_questions",
  ]);
  assert.deepEqual(result.expectedMutationChanges, [2, 2, 1, 1, 2]);
  assert.deepEqual(result.obsoleteIds, ["old-delete2", "old-delete1"]);
  assert.deepEqual(result.operations[1].rows.map(row => row.question_key), ["delete2", "delete1"]);
  assert.deepEqual(result.operations.filter(step => step.kind === "update_question").map(step => step.before.question_key), ["update2", "update1"]);
  assert.deepEqual(result.operations.filter(step => step.kind === "insert_questions")
    .flatMap(step => step.rows.map(row => row.question_key)), ["new0", "new1"]);
  assert.deepEqual(answers, [
    { question_id: "old-delete2", video_id: "v2" }, { question_id: "old-delete1", video_id: "v1" },
  ]);
});
test("MIG-0652 U03g: reject unrelated answers before producing any mutation", async () => {
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  assert.deepEqual(planStageQuestionMutationSteps({
    existing: [makeStageQuestionDiffRow("a")], next: [], deletedAnswers: [{ question_id: "foreign" }],
  }), { ok: false, reason: "unrelated_answer" });
});
test("MIG-0652 U03g: deleted answer cap is inclusive at 20", async () => {
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  for (const count of [20, 21]) {
    const result = planStageQuestionMutationSteps({
      existing: [makeStageQuestionDiffRow("a")], next: [],
      deletedAnswers: Array.from({ length: count }, () => ({ question_id: "old-a" })),
    });
    assert.equal(result.ok, count === 20);
    if (count === 21) assert.equal(result.reason, "answer_limit");
  }
});
test("MIG-0652 U03g: duplicate stage keys fail closed before mutation planning", async () => {
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  assert.deepEqual(planStageQuestionMutationSteps({
    existing: [], next: [makeStageQuestionDiffRow("a"), makeStageQuestionDiffRow("a")], deletedAnswers: [],
  }), { ok: false, reason: "duplicate_next_key" });
});

test("MIG-0652 U03h: stage UPDATE projection preserves CURRENT CAS and audited snapshot", async () => {
  const { projectStageQuestionUpdate } = await import("@flamenode/server-core/event/updatePayload");
  const before = { ...makeStageQuestionDiffRow("stage"), event_id: "ev_1", created_at: 100,
    updated_at: 150, custom_legacy_field: "retain" };
  const replacement = { ...makeStageQuestionDiffRow("stage", { label: "new", required: 1,
    description: null, placeholder: "", updated_at: 180 }), id: "regenerated",
    event_id: "ev_2", created_at: 175 };
  const beforeFrozen = structuredClone(before), replacementFrozen = structuredClone(replacement);
  const { cas, updateValues, after } = projectStageQuestionUpdate(before, replacement);
  const { id: _id, event_id: _eventId, created_at: _createdAt, ...currentValues } = replacement;
  assert.deepEqual(cas, { id: "old-stage", updated_at: 150 });
  assert.deepEqual(updateValues, currentValues);
  assert.deepEqual(after, { ...before, ...replacement, id: before.id, created_at: before.created_at });
  assert.equal(Object.hasOwn(updateValues, "id"), false);
  assert.equal(Object.hasOwn(updateValues, "event_id"), false);
  assert.equal(Object.hasOwn(updateValues, "created_at"), false);
  assert.deepEqual(before, beforeFrozen);
  assert.deepEqual(replacement, replacementFrozen);
});
test("MIG-0652 U03h: 256 stage update projections match frozen CURRENT object order and identity", async () => {
  const { projectStageQuestionUpdate } = await import("@flamenode/server-core/event/updatePayload");
  for (let i = 0; i < 256; i++) {
    const before = { ...makeStageQuestionDiffRow("k" + i, { required: i % 2,
      visibility: i % 3 === 0 ? "review" : "public", updated_at: i + 10 }),
      event_id: "original", created_at: 1, legacy_extra: "hold" };
    const replacement = { ...makeStageQuestionDiffRow("k" + i, {
      required: (i + 1) % 2, label: "value" + i,
      placeholder: i % 5 === 0 ? null : "", updated_at: i + 20 }),
      id: "generated-" + i, event_id: "submitted", created_at: 2 };
    const { id: _id, event_id: _eventId, created_at: _createdAt, ...expectedValues } = replacement;
    const actual = projectStageQuestionUpdate(before, replacement);
    assert.deepEqual(actual.cas, { id: before.id, updated_at: before.updated_at }, "CAS " + i);
    assert.deepEqual(actual.updateValues, expectedValues, "values " + i);
    assert.deepEqual(Object.keys(actual.updateValues), Object.keys(expectedValues), "order " + i);
    assert.deepEqual(actual.after, { ...before, ...replacement, id: before.id, created_at: before.created_at }, "snapshot " + i);
  }
});

/** U03i: actual SQLite/D1 batch test of the stage update projection.
 * This deliberately does not mount the CURRENT/Hono action or touch its owner. */
const stageUpdateSqliteFixture = () => {
  const f = createAtomicCreateHarness();
  seedCreateActor(f.sqlite);
  insert(f.sqlite, "events", event);
  const before = {
    ...makeStageQuestionDiffRow("stage_permission_a"),
    id: "stage_question_1", event_id: event.id,
    created_at: now - 100, updated_at: now - 10,
  };
  insert(f.sqlite, "event_custom_questions", before);
  return { ...f, before };
};
const stageUpdateSqlitePlan = async (db, before) => {
  const { and, eq } = await import("drizzle-orm");
  const { planStageQuestionMutationSteps, projectStageQuestionUpdate } =
    await import("@flamenode/server-core/event/updatePayload");
  const next = { ...before, id: "generated_replacement", label: "Updated stage",
    required: 1, updated_at: before.updated_at + 10 };
  const stage = planStageQuestionMutationSteps({
    existing: [before], next: [next], deletedAnswers: [],
  });
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.operations.map(x => x.kind), ["update_question"]);
  assert.deepEqual(stage.expectedMutationChanges, [1]);
  const projected = projectStageQuestionUpdate(before, next);
  return {
    mutationStatements: [db.update(schema.eventCustomQuestions)
      .set(projected.updateValues)
      .where(and(
        eq(schema.eventCustomQuestions.id, projected.cas.id),
        eq(schema.eventCustomQuestions.updated_at, projected.cas.updated_at),
      ))],
    expectedMutationChanges: stage.expectedMutationChanges,
    audits: [{
      table_name: "event_custom_questions", target_id: before.id, operation: "UPDATE",
      before, after: projected.after, actor_user_id: "u_admin",
      context: "event-update:stage-question", retention_class: "normal", strict: true,
    }],
  };
};

test("MIG-0652 U03i SQLite: stage CAS UPDATE and strict audit commit in one D1 batch", async () => {
  const f = stageUpdateSqliteFixture();
  const plan = await stageUpdateSqlitePlan(f.db, f.before);
  const ids = await mutateWithAudit(f.db, plan);
  assert.equal(ids.length, 1);
  assert.equal(f.d1.stats.batches, 1);
  const row = f.sqlite.prepare("SELECT id, event_id, created_at, updated_at, label, required FROM event_custom_questions").get();
  assert.deepEqual({ ...row }, { id: f.before.id, event_id: event.id,
    created_at: f.before.created_at, updated_at: f.before.updated_at + 10,
    label: "Updated stage", required: 1 });
  const audit = f.sqlite.prepare("SELECT operation, before_json, after_json FROM audit_logs WHERE table_name = 'event_custom_questions'").get();
  assert.equal(audit.operation, "UPDATE");
  assert.equal(JSON.parse(audit.before_json).label, f.before.label);
  assert.equal(JSON.parse(audit.after_json).label, "Updated stage");
  assert.equal(JSON.parse(audit.after_json).id, f.before.id);
  assert.ok(f.d1.stats.maxBinds <= 100);
});

test("MIG-0652 U03i SQLite: stale stage CAS rolls back and emits no false audit", async () => {
  const f = stageUpdateSqliteFixture();
  const plan = await stageUpdateSqlitePlan(f.db, f.before);
  f.sqlite.prepare("UPDATE event_custom_questions SET updated_at = ? WHERE id = ?")
    .run(f.before.updated_at + 1, f.before.id);
  await assert.rejects(mutateWithAudit(f.db, plan));
  assert.equal(f.d1.stats.batches, 1);
  const row = f.sqlite.prepare("SELECT label, updated_at FROM event_custom_questions").get();
  assert.equal(row.label, f.before.label);
  assert.equal(row.updated_at, f.before.updated_at + 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U03i SQLite: strict audit failure rolls back stage UPDATE", async () => {
  const f = stageUpdateSqliteFixture();
  const plan = await stageUpdateSqlitePlan(f.db, f.before);
  f.sqlite.exec("CREATE TRIGGER reject_stage_audit BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'stage-audit-denied'); END");
  await assert.rejects(mutateWithAudit(f.db, plan), /stage-audit-denied/);
  assert.equal(f.d1.stats.batches, 1);
  const row = f.sqlite.prepare("SELECT label, updated_at FROM event_custom_questions").get();
  assert.equal(row.label, f.before.label);
  assert.equal(row.updated_at, f.before.updated_at);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

/** U03j: real transactional D1 execution of the staged answer-first deletion plan.
 * These tests do not mount or claim the full CURRENT/Hono update API. */
async function stageDeleteSqliteFixture() {
  const f = stageUpdateSqliteFixture();
  const answers = ["v_stage_1", "v_stage_2"].map((video_id, index) => ({
    video_id, event_id: event.id, question_id: f.before.id,
    answer_text: "stage answer " + index, answer_json: null,
    created_at: now - 100, updated_at: now - 20 + index,
  }));
  for (const row of answers) insert(f.sqlite, "video_custom_answers", row);
  const { and, eq, or } = await import("drizzle-orm");
  const { planStageQuestionMutationSteps } =
    await import("@flamenode/server-core/event/updatePayload");
  const stage = planStageQuestionMutationSteps({
    existing: [f.before], next: [], deletedAnswers: answers,
  });
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.operations.map(step => step.kind),
    ["delete_answers", "delete_questions"]);
  assert.deepEqual(stage.expectedMutationChanges, [2, 1]);
  const statements = [];
  const audits = [];
  for (const operation of stage.operations) {
    if (operation.kind === "delete_answers") {
      statements.push(f.db.delete(schema.videoCustomAnswers).where(or(
        ...operation.rows.map(row => and(
          eq(schema.videoCustomAnswers.video_id, row.video_id),
          eq(schema.videoCustomAnswers.event_id, row.event_id),
          eq(schema.videoCustomAnswers.question_id, row.question_id),
          eq(schema.videoCustomAnswers.updated_at, row.updated_at),
        )),
      )));
      audits.push(...operation.rows.map(row => ({
        table_name: "video_custom_answers",
        target_id: row.video_id + ":" + row.event_id + ":" + row.question_id,
        operation: "DELETE", before: row, after: null,
        actor_user_id: "u_admin", context: "event-update:removed-stage-question-answer",
        retention_class: "normal", strict: true,
      })));
    } else if (operation.kind === "delete_questions") {
      statements.push(f.db.delete(schema.eventCustomQuestions).where(or(
        ...operation.rows.map(row => and(
          eq(schema.eventCustomQuestions.id, row.id),
          eq(schema.eventCustomQuestions.updated_at, row.updated_at),
        )),
      )));
      audits.push(...operation.rows.map(row => ({
        table_name: "event_custom_questions", target_id: row.id,
        operation: "DELETE", before: row, after: null,
        actor_user_id: "u_admin", context: "event-update:removed-stage-question",
        retention_class: "normal", strict: true,
      })));
    } else {
      assert.fail("unexpected stage deletion operation: " + operation.kind);
    }
  }
  const mutationPlan = {
    mutationStatements: statements,
    expectedMutationChanges: stage.expectedMutationChanges,
    audits,
  };
  return { ...f, answers, stage, mutationPlan };
}

test("MIG-0652 U03j SQLite: answer-first cascade delete and three strict audits commit atomically", async () => {
  const f = await stageDeleteSqliteFixture();
  const auditIds = await mutateWithAudit(f.db, f.mutationPlan);
  assert.equal(auditIds.length, 3);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 0);
  const auditRows = f.sqlite.prepare(
    "SELECT table_name, operation, target_id FROM audit_logs ORDER BY rowid").all();
  assert.deepEqual(auditRows.map(row => [row.table_name, row.operation, row.target_id]), [
    ["video_custom_answers", "DELETE", f.answers[0].video_id + ":" + event.id + ":" + f.before.id],
    ["video_custom_answers", "DELETE", f.answers[1].video_id + ":" + event.id + ":" + f.before.id],
    ["event_custom_questions", "DELETE", f.before.id],
  ]);
  assert.ok(f.d1.stats.maxBinds <= 100);
});

test("MIG-0652 U03j SQLite: one stale answer CAS rolls back all deletes and audits", async () => {
  const f = await stageDeleteSqliteFixture();
  f.sqlite.prepare("UPDATE video_custom_answers SET updated_at = updated_at + 1 WHERE video_id = ?")
    .run(f.answers[1].video_id);
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan));
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT updated_at FROM video_custom_answers WHERE video_id = ?")
    .get(f.answers[1].video_id).updated_at, f.answers[1].updated_at + 1);
});

test("MIG-0652 U03j SQLite: stale question CAS rolls back successful answer deletion", async () => {
  const f = await stageDeleteSqliteFixture();
  f.sqlite.prepare("UPDATE event_custom_questions SET updated_at = updated_at + 1 WHERE id = ?")
    .run(f.before.id);
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan));
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U03j SQLite: late strict audit rejection undoes answer and question deletions", async () => {
  const f = await stageDeleteSqliteFixture();
  f.sqlite.exec("CREATE TRIGGER reject_stage_cascade_audit BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'stage-cascade-audit-denied'); END");
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan), /stage-cascade-audit-denied/);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

/** U03k: stage-question insertion in the existing actual SQLite D1 audit harness.
 * Four is the CURRENT stage-question form maximum; this is not a mounted route. */
async function stageInsertSqliteFixture() {
  const f = createAtomicCreateHarness();
  seedCreateActor(f.sqlite);
  insert(f.sqlite, "events", event);
  const next = Array.from({ length: 4 }, (_, index) => ({
    ...makeStageQuestionDiffRow("stage_permission_new_" + index, {
      id: "stage_new_" + index,
      label: "Stage question " + index,
      sort_order: index,
      updated_at: now,
    }),
    event_id: event.id,
    created_at: now,
  }));
  const { planStageQuestionMutationSteps } =
    await import("@flamenode/server-core/event/updatePayload");
  const stage = planStageQuestionMutationSteps({
    existing: [], next, deletedAnswers: [],
  });
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.operations.map(step => step.kind), ["insert_questions"]);
  assert.deepEqual(stage.expectedMutationChanges, [4]);
  const statements = stage.operations.map(step => {
    assert.equal(step.kind, "insert_questions");
    return f.db.insert(schema.eventCustomQuestions).values(step.rows);
  });
  const audits = next.map(row => ({
    table_name: "event_custom_questions", target_id: row.id,
    operation: "CREATE", before: null, after: row,
    actor_user_id: "u_admin", context: "event-update:stage-question",
    retention_class: "normal", strict: true,
  }));
  return { ...f, next, mutationPlan: {
    mutationStatements: statements,
    expectedMutationChanges: stage.expectedMutationChanges,
    audits,
  } };
}

test("MIG-0652 U03k SQLite: four stage inserts and four strict audits commit in one D1 batch", async () => {
  const f = await stageInsertSqliteFixture();
  const auditIds = await mutateWithAudit(f.db, f.mutationPlan);
  assert.equal(auditIds.length, 4);
  assert.equal(f.d1.stats.batches, 1);
  const questions = f.sqlite.prepare(
    "SELECT id, question_key, sort_order FROM event_custom_questions ORDER BY sort_order"
  ).all();
  assert.deepEqual(questions.map(row => row.id), f.next.map(row => row.id));
  assert.deepEqual(questions.map(row => row.question_key), f.next.map(row => row.question_key));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE operation = 'CREATE' AND table_name = 'event_custom_questions'").get().n, 4);
  assert.ok(f.d1.stats.maxBinds <= 100);
});

test("MIG-0652 U03k SQLite: conflicting stage insert aborts all new question/audit writes", async () => {
  const f = await stageInsertSqliteFixture();
  // The first row can be inserted, but the second collides on event + question_key.
  // The real unique constraint must reject the entire D1 batch atomically.
  insert(f.sqlite, "event_custom_questions", {
    ...f.next[1], id: "preexisting_conflict", created_at: now - 10,
  });
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan));
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT id FROM event_custom_questions").get().id, "preexisting_conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

/** U03l: all four stage operation families in ONE audited SQLite transaction. */
async function stageMixedSqliteFixture() {
  const f = await stageDeleteSqliteFixture();
  const updatedBefore = {
    ...f.before, id: "stage_question_keep", question_key: "stage_permission_keep",
    label: "Before update", updated_at: now - 5,
  };
  insert(f.sqlite, "event_custom_questions", updatedBefore);
  const updatedNext = {
    ...updatedBefore, id: "regenerated_keep", label: "After update",
    updated_at: now + 1,
  };
  const insertedRows = ["new_a", "new_b"].map((key, index) => ({
    ...updatedBefore, id: "stage_insert_" + index,
    question_key: "stage_permission_" + key, label: "Added " + index,
    sort_order: index + 2, created_at: now, updated_at: now,
  }));
  const { planStageQuestionMutationSteps, buildStageQuestionD1MutationBatch } =
    await import("@flamenode/server-core/event/updatePayload");
  const existing = [f.before, updatedBefore];
  const next = [insertedRows[0], updatedNext, insertedRows[1]];
  const stage = planStageQuestionMutationSteps({
    existing, next, deletedAnswers: f.answers,
  });
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.operations.map(step => step.kind),
    ["delete_answers", "delete_questions", "update_question", "insert_questions"]);
  assert.deepEqual(stage.expectedMutationChanges, [2, 1, 1, 2]);
  const mutationPlan = buildStageQuestionD1MutationBatch({
    db: f.db, existing, next, deletedAnswers: f.answers, actorUserId: "u_admin",
  });
  assert.equal(mutationPlan.ok, true);
  assert.deepEqual(mutationPlan.expectedMutationChanges, stage.expectedMutationChanges);
  assert.deepEqual(mutationPlan.audits.map(audit => audit.operation),
    ["DELETE", "DELETE", "DELETE", "UPDATE", "CREATE", "CREATE"]);
  return { ...f, updatedBefore, insertedRows, stage, mutationPlan };
}

test("MIG-0652 U03l SQLite: mixed answer delete/question delete/update/insert and six audits commit once", async () => {
  const f = await stageMixedSqliteFixture();
  const ids = await mutateWithAudit(f.db, f.mutationPlan);
  assert.equal(ids.length, 6);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 0);
  assert.deepEqual(
    f.sqlite.prepare("SELECT id FROM event_custom_questions ORDER BY id").all().map(row => row.id),
    ["stage_insert_0", "stage_insert_1", "stage_question_keep"]);
  assert.equal(f.sqlite.prepare("SELECT label FROM event_custom_questions WHERE id = 'stage_question_keep'").get().label, "After update");
  assert.deepEqual(f.sqlite.prepare("SELECT operation FROM audit_logs ORDER BY rowid").all().map(row => row.operation),
    ["DELETE", "DELETE", "DELETE", "UPDATE", "CREATE", "CREATE"]);
  assert.ok(f.d1.stats.maxBinds <= 100);
});

test("MIG-0652 U03l SQLite: stale mixed question update aborts earlier answer/question deletes and later inserts", async () => {
  const f = await stageMixedSqliteFixture();
  f.sqlite.prepare("UPDATE event_custom_questions SET updated_at = updated_at + 1 WHERE id = ?")
    .run(f.updatedBefore.id);
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan));
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT label FROM event_custom_questions WHERE id = ?")
    .get(f.updatedBefore.id).label, "Before update");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U03l SQLite: late insert collision rolls back all preceding mixed mutations", async () => {
  const f = await stageMixedSqliteFixture();
  insert(f.sqlite, "event_custom_questions", {
    ...f.insertedRows[1], id: "preexisting_mix_collision",
  });
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan));
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 3);
  assert.equal(f.sqlite.prepare("SELECT label FROM event_custom_questions WHERE id = ?")
    .get(f.updatedBefore.id).label, "Before update");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U03l SQLite: late mixed strict-audit failure rolls back all four operation families", async () => {
  const f = await stageMixedSqliteFixture();
  f.sqlite.exec("CREATE TRIGGER reject_stage_mixed_audit BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'stage-mixed-audit-denied'); END");
  await assert.rejects(mutateWithAudit(f.db, f.mutationPlan), /stage-mixed-audit-denied/);
  assert.equal(f.d1.stats.batches, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("MIG-0652 U03m: stage planner enforces CURRENT four-question cap and rejects five", async () => {
  const { MAX_STAGE_PERMISSION_QUESTIONS } = await import("@flamenode/domain/event/limits");
  const { planStageQuestionMutationSteps } = await import("@flamenode/server-core/event/updatePayload");
  assert.equal(MAX_STAGE_PERMISSION_QUESTIONS, 4);
  const rows = Array.from({ length: MAX_STAGE_PERMISSION_QUESTIONS + 1 },
    (_, index) => makeStageQuestionDiffRow("stage_permission_" + index));
  const allowed = planStageQuestionMutationSteps({
    existing: [], next: rows.slice(0, MAX_STAGE_PERMISSION_QUESTIONS), deletedAnswers: [],
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.expectedMutationChanges, [4]);
  assert.deepEqual(planStageQuestionMutationSteps({
    existing: [], next: rows, deletedAnswers: [],
  }), { ok: false, reason: "stage_limit" });
});

test("MIG-0652 U03n: shared D1 mutation builder rejects over-cap and foreign answer before SQL", async () => {
  const { buildStageQuestionD1MutationBatch } = await import("@flamenode/server-core/event/updatePayload");
  const f = stageUpdateSqliteFixture();
  const rows = Array.from({ length: 5 }, (_, index) => ({
    ...f.before, id: "stage_cap_" + index, question_key: "stage_permission_cap_" + index,
  }));
  assert.deepEqual(buildStageQuestionD1MutationBatch({
    db: f.db, existing: [], next: rows, deletedAnswers: [], actorUserId: "u_admin",
  }), { ok: false, reason: "stage_limit" });
  assert.deepEqual(buildStageQuestionD1MutationBatch({
    db: f.db, existing: [f.before], next: [],
    deletedAnswers: [{ video_id: "foreign", event_id: event.id, question_id: "other",
      answer_text: "", answer_json: null, created_at: now, updated_at: now }],
    actorUserId: "u_admin",
  }), { ok: false, reason: "unrelated_answer" });
  assert.equal(f.d1.stats.batches, 0);
});
