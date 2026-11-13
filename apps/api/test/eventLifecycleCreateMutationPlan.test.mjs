import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import {
  buildEventCreateFields,
  buildEventCreateOwnerStaffRow,
  buildEventCreateStageQuestionRows,
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

const db = drizzle(createD1(createSqlite()), { schema });
const now = 1794115200;
const owner = buildEventCreateOwnerStaffRow({
  staffId: "es_owner", eventId: "ev_create", actorUserId: "u_admin",
  verifiedOwnerIdentity: { x_user_id: "x_approved", display_name: "Approved" }, now,
});
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
    actorUserId: "u_admin", hasRenameTombstone: false,
    ...overrides,
  });
};

/** Transactional D1 on the complete migrated schema; unlike createD1 this fake
 * models D1 batch BEGIN/ROLLBACK and per-statement changes() assertions. */
function createAtomicCreateHarness() {
  const sqlite = createSqlite();
  const stats = { batches: 0, statements: 0, maxBinds: 0 };
  const execSql = (sqlText, params, arrays = false) => {
    stats.statements += 1;
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
      }
    },
  };
  return { sqlite, d1, db: drizzle(d1, { schema }) };
}

function createExecutableWritePlan(db, queue = { statements: [], expectedChanges: [], acceptedTargetCount: 0 }) {
  const questionRows = createQuestions(2);
  const planned = planEventCreateQuestionBatch({
    templateGeneralQuestions: questionRows,
    submittedGeneral: { present: false }, stageQuestions: [],
  });
  assert.equal(planned.ok, true);
  const plan = planEventCreateAtomicWrite({
    db, eventRow: event, ownerRow: owner,
    questionRows, questionChunks: planned.chunks,
    queue,
    actorUserId: "u_admin", hasRenameTombstone: false,
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
  assert.match(core, /planD1AuditMutationBudget\(/);
  assert.match(core, /mutationAssertionCount: mutationStatements.length/);
  assert.match(core, /preMutationAssertionCount: preMutationAssertions.length/);
  assert.match(core, /approval_status/);
  assert.doesNotMatch(core, /staticRebuildWakeSource:/);
  assert.match(source, /const mutationStatements = \[/);
  assert.match(source, /context: "event-create:owner"/);
  assert.match(source, /restore_strategy: "delete_created"/);
  assert.match(source, /public_api_enabled: 0/);
  assert.match(core, /eventRow\.public_api_enabled !== 0/);
  assert.match(core, /ownerRow\.custom_permission_keys_json !== null/);
});
