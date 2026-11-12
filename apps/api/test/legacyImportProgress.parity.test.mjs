import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  legacyImportApplyProgressSummary,
  LEGACY_IMPORT_X_USER_STEP_SIZE, LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
  LEGACY_IMPORT_QUESTION_STEP_SIZE,
} from "../src/routes/admin/legacyImportProgress.ts";


const empty = () => ({
  xUsers: [], videoSoftwares: [], events: [], eventCustomQuestions: [], videos: [],
});

test("RH-002 U02 progress: chunks match CURRENT and empty stages count one", async () => {
  // apply.ts imports server-only/Next DB modules, so check its exported literals without executing it.
  const source = await readFile(new URL("../../../src/lib/import/legacy/apply.ts", import.meta.url), "utf8");
  const original = (name) => Number(source.match(new RegExp(`export const ${name} = (\\d+);`))?.[1]);
  const CURRENT_X_STEP = original("LEGACY_IMPORT_X_USER_STEP_SIZE");
  const CURRENT_SOFTWARE_STEP = original("LEGACY_IMPORT_SOFTWARE_STEP_SIZE");
  const CURRENT_QUESTION_STEP = original("LEGACY_IMPORT_QUESTION_STEP_SIZE");
  assert.equal(LEGACY_IMPORT_X_USER_STEP_SIZE, CURRENT_X_STEP);
  assert.equal(LEGACY_IMPORT_SOFTWARE_STEP_SIZE, CURRENT_SOFTWARE_STEP);
  assert.equal(LEGACY_IMPORT_QUESTION_STEP_SIZE, CURRENT_QUESTION_STEP);
  const plan = empty();
  assert.deepEqual(legacyImportApplyProgressSummary(plan, { stage: "system_user", index: 0 }),
    { stage: "system_user", index: 0, completed: 0, total: 6 });
  assert.deepEqual(legacyImportApplyProgressSummary(plan, { stage: "complete", index: 0 }),
    { stage: "complete", index: 0, completed: 6, total: 6 });
  assert.equal(legacyImportApplyProgressSummary(plan, { stage: "videos", index: 0 }).completed, 5);
});

test("RH-002 U02 progress: duplicate/casefold software names are one logical row", () => {
  const plan = { ...empty(),
    xUsers: Array.from({ length: 41 }, () => ({})),
    videoSoftwares: Array.from({ length: 41 }, (_, i) => ({
      label: i === 0 ? "  Premiere   Pro " : i === 1 ? "premiere pro" : `software-${i}`,
    })),
    eventCustomQuestions: Array.from({ length: 7 }, () => ({})),
    events: [{}, {}],
    videos: [{}, {}, {}],
  };
  // 1 system + 2 X + 1 software + 2 events + 2 questions + 3 videos
  const stages = [
    ["system_user", 0, 0],
    ["x_users", 1, 2],
    ["softwares", 0, 3],
    ["events", 1, 5],
    ["custom_questions", 1, 7],
    ["videos", 2, 10],
    ["complete", 0, 11],
  ];
  for (const [stage, index, completed] of stages) {
    const result = legacyImportApplyProgressSummary(plan, { stage, index });
    assert.equal(result.total, 11);
    assert.equal(result.completed, completed, stage);
    assert.equal(result.stage, stage);
    assert.equal(result.index, index);
  }
});

test("RH-002 U02 progress: CURRENT single-step and R2 CAS ordering remain an integration gate", async () => {
  const current = await readFile(new URL("../../../app/api/admin/import/legacy/route.ts", import.meta.url), "utf8");
  const commit = current.indexOf("const step = await applyLegacyImportPlanStep(");
  const advance = current.indexOf("await claimed.advance(step.progress)");
  assert.ok(commit >= 0 && advance > commit, "D1 commit precedes R2 progress advance");
  assert.match(current.slice(advance), /committed_progress_pending/);
});


test("RH-002 stage progress: CURRENT and Hono share identical canonical function", async () => {
  const { legacyImportApplyProgressSummary: shared } =
    await import("@flamenode/server-core/legacyImport/progress");
  assert.equal(shared, legacyImportApplyProgressSummary);
  const source = await readFile(new URL("../../../app/api/admin/import/legacy/route.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ legacyImportApplyProgressSummary as applyProgressSummary \} from "@flamenode\/server-core\/legacyImport\/progress"/);
  assert.doesNotMatch(source, /function applyProgressSummary\(/);
  const claimProgress = { stage: "videos", index: 2 };
  const plan = {
    ...empty(), events: [1, 2, 3],
    videos: [1, 2, 3, 4],
    videoSoftwares: [{ label: "x" }, { label: "X" }, { label: "y" }],
  };
  assert.deepEqual(legacyImportApplyProgressSummary(plan, claimProgress),
    shared(plan, claimProgress));
});
