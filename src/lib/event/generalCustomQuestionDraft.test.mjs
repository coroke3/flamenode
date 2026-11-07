import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const draftSource = await readFile(
  new URL("./generalCustomQuestionDraft.ts", import.meta.url),
  "utf8",
);
const planSource = await readFile(
  new URL("./generalCustomQuestionPlan.ts", import.meta.url),
  "utf8",
);
const planDomainSource = await readFile(
  new URL("../../../packages/domain/src/event/generalQuestionPlanner.ts", import.meta.url),
  "utf8",
);
const limitsSource = await readFile(
  new URL("../../../packages/domain/src/event/limits.ts", import.meta.url),
  "utf8",
);
const capSource = await readFile(
  new URL("../../../packages/domain/src/event/generalQuestionCap.ts", import.meta.url),
  "utf8",
);

const draftDomainSource = await readFile(
  new URL("../../../packages/domain/src/event/generalQuestionDraft.ts", import.meta.url),
  "utf8",
);

test("MIG-0652 U01: custom-question projection uses a domain bridge", () => {
  assert.ok(draftSource.includes('export { customQuestionToDraft } from "@flamenode/domain/event";'));
  assert.ok(!draftSource.includes("export function customQuestionToDraft("));
  assert.ok(draftDomainSource.includes("export function customQuestionToDraft("));
  assert.ok(!draftDomainSource.includes('from "@/'));
});

test("empty draft factory avoids stage_permission keys and defaults to textarea", () => {
  assert.match(draftSource, /question_key: `q_\$\{suffix\}`/);
  assert.match(draftSource, /generateId\(\)/);
  assert.doesNotMatch(draftSource, /Math\.random/);
  assert.match(draftSource, /type: "textarea"/);
  assert.doesNotMatch(draftSource, /question_key: `stage_permission/);
});

test("form reader drops stage keys and parses newline options", () => {
  assert.match(draftSource, /isStagePermissionQuestionKey\(question_key\)/);
  assert.match(draftSource, /normalizeOptionList/);
  assert.match(draftSource, /parseQuestionType/);
});

test("planned rows retain CURRENT validation via a domain planner", () => {
  assert.ok(planSource.includes("plannedGeneralQuestionsFromDraftsCore"));
  assert.ok(planSource.includes('generateId("ecq")'));
  assert.ok(planDomainSource.includes("questionTypeNeedsOptions(type) && !optionsJson"));
  assert.ok(planDomainSource.includes('visibility: "review"'));
  assert.ok(planDomainSource.includes("isStagePermissionQuestionKey(key)"));
  assert.ok(planDomainSource.includes("serializeOptionsJson"));
  assert.ok(!planDomainSource.includes('from "@/'));
});

test("cap never goes below MAX_GENERAL_CUSTOM_QUESTIONS", () => {
  assert.match(limitsSource, /MAX_GENERAL_CUSTOM_QUESTIONS = 4/);
  assert.match(capSource, /Math\.max\(\s*MAX_GENERAL_CUSTOM_QUESTIONS/);
  assert.match(planSource, /export \{ resolveGeneralCustomQuestionCap \} from "@flamenode\/domain\/event"/);
});
