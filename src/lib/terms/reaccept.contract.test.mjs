import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const rules = await readFile(new URL("../actions/rules.ts", import.meta.url), "utf8");
const accept = await readFile(new URL("../actions/terms.ts", import.meta.url), "utf8");
const currentUser = await readFile(new URL("../auth/currentUser.ts", import.meta.url), "utf8");
const adminPage = await readFile(new URL("../../../app/(admin)/admin/rules/page.tsx", import.meta.url), "utf8");

test("major publish never counts or updates every user", () => {
  const publish = rules.slice(
    rules.indexOf("export async function publishTermsVersion"),
    rules.indexOf("export async function broadcastTermsReaccept"),
  );
  assert.doesNotMatch(publish, /count\(/i);
  assert.doesNotMatch(publish, /update\(users\)/);
  assert.doesNotMatch(publish, /terms_reaccept_required/);
  assert.match(publish, /\(current\?\.published_at \?\? 0\) \+ 1/);
  assert.doesNotMatch(adminPage, /COUNT\(\*\)/i);
  assert.match(adminPage, /\.limit\(31\)/);
});

test("current user, admin preview, and broadcast share the dynamic predicate", () => {
  assert.match(currentUser, /termsReacceptRequiredValue\(requiredMajor\)/);
  assert.match(rules, /termsReacceptRequiredCondition\(requiredMajor\)/);
  assert.match(adminPage, /termsReacceptRequiredCondition\(requiredMajor\)/);
  assert.doesNotMatch(currentUser, /terms_reaccept_required: users\.terms_reaccept_required/);
});

test("terms acceptance uses scoped CAS audit batch without revalidatePath", () => {
  assert.match(accept, /mutateWithAudit\(db/);
  assert.match(accept, /expectedMutationChanges/);
  assert.match(accept, /table_name: "user_tos_consents"/);
  assert.match(accept, /table_name: "user"/);
  assert.match(accept, /expectedRowCondition/);
  assert.match(accept, /accepted_terms_version_id: userBefore\.accepted_terms_version_id/);
  assert.match(accept, /is_tos_accepted: userBefore\.is_tos_accepted/);
  assert.match(accept, /terms_reaccept_required: userBefore\.terms_reaccept_required/);
  assert.doesNotMatch(accept, /revalidatePath\(/);
  assert.match(accept, /unstable_rethrow\(error\)/);
  assert.match(accept, /kind: "already_accepted"/);
  assert.match(accept, /before: \{ \.\.\.userBefore \}/);
  assert.match(accept, /after: \{ \.\.\.userAfter \}/);
});
