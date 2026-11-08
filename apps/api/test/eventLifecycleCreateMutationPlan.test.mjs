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
import { createSqlite, createD1 } from "./support/personalHarness.mjs";

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
  assert.doesNotMatch(core, /staticRebuildWakeSource:/);
  assert.match(source, /const mutationStatements = \[/);
  assert.match(source, /context: "event-create:owner"/);
  assert.match(source, /restore_strategy: "delete_created"/);
});
