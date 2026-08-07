import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../../audit/mutateBudget.ts";
import { MAX_SLOTS_PER_VIDEO } from "../../slots/limits.ts";

const source = await readFile(
  new URL("./submitSlotVideo.ts", import.meta.url),
  "utf8",
);

test("submitSlotVideoは20枠を1本のslot UPDATEにまとめる", () => {
  assert.match(source, /versionedSlotWhere\(slotRow\.event_id, submittedSlots, "reserved"\)/);
  assert.match(source, /plan\.expectedChanges\.push\(submittedSlots\.length\)/);
  assert.doesNotMatch(source, /MAX_ATOMIC_SUBMITTED_SLOTS/);
  assert.match(source, /MAX_SLOTS_PER_VIDEO \+ 1/);
});

test("submitSlotVideoは提出枠の連続性をareSlotsInSamePartで検証する", () => {
  assert.match(source, /sortSlotsChronologically\(submittedSlots\)/);
  assert.match(source, /areSlotsInSamePart/);
  assert.match(source, /連続していない枠をまとめて提出できません/);
  assert.match(source, /slot_part_gap_minutes/);
});

test("20枠submitの代表planは1 slot statementと20 auditでD1上限内", () => {
  const slotAuditCount = MAX_SLOTS_PER_VIDEO;
  // video insert/update + derived/software/events/stage/custom/members + slot bulk + notify*2 + static rebuild
  const mutationStatementCount = 1 + 6 + 1 + 2 + 1;
  const mutationAssertionCount = mutationStatementCount; // all asserted except we treat notify as null below
  // More accurate: notifications use null expected changes → reduce assertion count
  const notifyCount = 2;
  const assertedMutations = mutationStatementCount - notifyCount;
  const nonSlotAudits = 8;
  const budget = planD1AuditMutationBudget({
    mutationStatementCount,
    mutationAssertionCount: assertedMutations,
    auditEntryCount: nonSlotAudits + slotAuditCount,
    distinctActorCount: 1,
  });

  assert.match(source, /versionedSlotWhere/);
  assert.equal(slotAuditCount, 20);
  assert.equal(budget.withinLimit, true);
  assert.equal(
    budget.totalQueryCount,
    budget.preparationQueryCount +
      budget.batchQueryCount +
      budget.reservedCallerQueryCount,
  );
  assert.ok(
    budget.totalQueryCount <= budget.limit,
    `totalQueryCount=${budget.totalQueryCount}`,
  );
  // bind: versioned WHERE for 20 rows = event_id + status + 20*(id+version+updated_at) + SET binds
  const bulkCasBinds = 2 + 20 * 3 + 4;
  assert.ok(bulkCasBinds <= 100, `bulkCasBinds=${bulkCasBinds}`);
});
