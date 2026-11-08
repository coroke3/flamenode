import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildEventCreateStageQuestionRows,
  buildEventCreateTemplateQuestionRows,
  planEventCreateQuestionBatch,
} from "@flamenode/domain/event";

const isReserved = (key) => key === "stage_permission" || key.startsWith("stage_permission_");
const ids = () => {
  let n = 0;
  return () => "ecq_" + ++n;
};
const makeTemplate = (question_key, changes = {}) => ({
  question_key,
  label: "Question " + question_key,
  description: null,
  type: "text",
  required: false,
  options_json: null,
  placeholder: null,
  max_length: 200,
  sort_order: 0,
  is_active: true,
  visibility: "review",
  ...changes,
});
const fromTemplate = (defs, overrides = {}) =>
  buildEventCreateTemplateQuestionRows({
    eventId: "ev_created",
    templateSnapshot: defs === null ? null : { custom_question_definitions: defs },
    now: 1794115200,
    createId: ids(),
    isStagePermissionQuestionKey: isReserved,
    ...overrides,
  });
const fromStage = (fields, overrides = {}) =>
  buildEventCreateStageQuestionRows({
    eventId: "ev_created",
    fields,
    now: 1794115200,
    createId: ids(),
    ...overrides,
  });

test("MIG-0652 U02 question rows: stage projection matches all 15 CURRENT DB fields and defaults", () => {
  assert.deepEqual(fromStage([{
    id: "stage_permission", label: "Stage use", description: "Rights",
    placeholder: "What was used?", required: true,
  }]), [{
    id: "ecq_1", event_id: "ev_created",
    question_key: "stage_permission", label: "Stage use",
    description: "Rights", type: "textarea", required: 1,
    options_json: null, placeholder: "What was used?",
    max_length: 1000, sort_order: 0, is_active: 1,
    visibility: "review", created_at: 1794115200, updated_at: 1794115200,
  }]);
});

test("MIG-0652 U02 question rows: multiple normalized stage questions keep order, false and blanks", () => {
  const result = fromStage([
    { id: "stage_permission", label: "One", description: "", placeholder: "", required: false },
    { id: "stage_permission_2", label: "Two", description: "Details", placeholder: "Example", required: true },
  ]);
  assert.deepEqual(result.map((r) => [r.id, r.question_key, r.sort_order, r.required, r.description, r.placeholder]),
    [["ecq_1", "stage_permission", 0, 0, null, null],
     ["ecq_2", "stage_permission_2", 1, 1, "Details", "Example"]]);
  assert.deepEqual(fromStage([]), []);
});

test("MIG-0652 U02 question rows: template mapping keeps exact options/type/visibility and booleans", () => {
  const result = fromTemplate([
    makeTemplate("schedule", {
      type: "select", required: true, is_active: false,
      options_json: '["morning","night"]', visibility: "private",
      description: "Pick a time", placeholder: "Select",
      max_length: null, sort_order: 17,
    }),
  ]);
  assert.deepEqual(result, [{
    id: "ecq_1", event_id: "ev_created",
    question_key: "schedule", label: "Question schedule",
    description: "Pick a time", type: "select", required: 1,
    options_json: '["morning","night"]', placeholder: "Select",
    max_length: null, sort_order: 17, is_active: 0,
    visibility: "private", created_at: 1794115200, updated_at: 1794115200,
  }]);
});

test("MIG-0652 U02 question rows: template excludes reserved stage keys before generating IDs", () => {
  const result = fromTemplate([
    makeTemplate("stage_permission"),
    makeTemplate("stage_permission_3"),
    makeTemplate("description"),
    makeTemplate("other", { visibility: "public" }),
  ]);
  assert.deepEqual(result.map((r) => [r.id, r.question_key, r.visibility]),
    [["ecq_1", "description", "review"], ["ecq_2", "other", "public"]]);
  assert.equal(fromTemplate(null).length, 0);
  assert.equal(fromTemplate([]).length, 0);
});

test("MIG-0652 U02 question rows: adapter key predicate is authoritative (not silently replaced)", () => {
  const consideredReserved = [];
  const rows = fromTemplate([makeTemplate("special"), makeTemplate("other")], {
    isStagePermissionQuestionKey: (key) => {
      consideredReserved.push(key);
      return key === "special";
    },
  });
  assert.deepEqual(consideredReserved, ["special", "other"]);
  assert.deepEqual(rows.map((r) => r.question_key), ["other"]);
});

test("MIG-0652 U02 question rows: original input arrays and template definitions are not mutated", () => {
  const template = Object.freeze(makeTemplate("prompt", { required: true }));
  const definitions = Object.freeze([template]);
  const fields = Object.freeze([Object.freeze({
    id: "stage_permission", label: "Stage", description: "", placeholder: "", required: false,
  })]);
  const mappedTemplate = fromTemplate(definitions);
  const mappedStage = fromStage(fields);
  assert.equal(template.required, true);
  assert.equal(fields[0].required, false);
  assert.notEqual(mappedTemplate[0], template);
  assert.notEqual(mappedStage[0], fields[0]);
});

test("MIG-0652 U02 question rows: outputs integrate with 6-row planner without changing ordering", () => {
  const template = fromTemplate(Array.from({ length: 5 }, (_, i) => makeTemplate("general_" + i)));
  const stage = fromStage([{
    id: "stage_permission", label: "Stage", description: "", placeholder: "", required: true,
  }]);
  const plan = planEventCreateQuestionBatch({
    templateGeneralQuestions: template,
    submittedGeneral: { present: false },
    stageQuestions: stage,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.questions.map((r) => r.question_key),
    ["general_0", "general_1", "general_2", "general_3", "general_4", "stage_permission"]);
  assert.deepEqual(plan.chunks.map((c) => c.length), [6]);
});

test("MIG-0652 U02 question rows: CURRENT mapping and security preflight remain adapter-owned", async () => {
  const legacy = await readFile(new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/createQuestionRows.ts", import.meta.url), "utf8");
  assert.match(legacy, /function stageQuestionRows\(/);
  assert.match(legacy, /function templateGeneralQuestionRows\(/);
  assert.match(legacy, /resolveStagePermissionFieldsFromJson\(\[settingsJson\]\)/);
  assert.match(legacy, /\.filter\(\(definition\) => !isStagePermissionQuestionKey\(definition\.question_key\)\)/);
  assert.match(legacy, /const ownerIdentity = \(/);
  assert.match(legacy, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.doesNotMatch(core, /from ["']@\//);
  assert.doesNotMatch(core, /drizzle|D1Database|generateId\(|fetch\(/);
});
