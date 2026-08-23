import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const loggerSource = await readFile(new URL("./logger.ts", import.meta.url), "utf8");
const mutateSource = await readFile(new URL("./mutate.ts", import.meta.url), "utf8");
const budgetSource = await readFile(new URL("./mutateBudget.ts", import.meta.url), "utf8");

test("actor_x_user_id検証はaudit件数分SELECTせずJSON1 1 queryへまとめる", () => {
  assert.match(loggerSource, /async function loadApprovedActorXPairs/);
  assert.match(loggerSource, /FROM json_each\(\$\{payload\}\)/);
  assert.match(loggerSource, /const approvedActorXPairs =/);
  assert.doesNotMatch(loggerSource, /for \(const input of activeInputs\)[\s\S]*?await validateActorXUserId/);
});

test("actor X検証queryはmutateWithAuditのD1予算にも含める", () => {
  assert.match(mutateSource, /const actorXValidationQueryCount = input\.audits\.some/);
  assert.match(mutateSource, /actorXValidationQueryCount,/);
  assert.match(budgetSource, /actorXValidationQueryCount\?: number/);
  assert.match(
    budgetSource,
    /1 \+ Math\.max\(0, input\.distinctActorCount\) \+ actorXValidationQueryCount/,
  );
});

test("監査INSERTは21列bindを4entry以下へchunkする", () => {
  assert.match(budgetSource, /AUDIT_COLUMN_BIND_COUNT = 21/);
  assert.match(budgetSource, /D1_MAX_BIND_PARAMETERS \/ AUDIT_COLUMN_BIND_COUNT/);
});
