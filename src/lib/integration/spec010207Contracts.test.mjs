import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("仕様01/02のD1 baselineはowner subjectとleaseのcanonical契約を持つ", () => {
  const baseline = read("migrations/0000_flame_node_baseline.sql");
  assert.match(baseline, /CREATE TABLE "event_staff"/);
  assert.match(baseline, /permission_preset.*CHECK.*'owner'/s);
  assert.match(baseline, /event_staff_subject_required.*user_id.*x_user_id/s);
  assert.match(baseline, /CREATE TABLE "worker_leases"/);
  assert.match(baseline, /"lease_expires_at" integer NOT NULL/);
  assert.doesNotMatch(baseline, /lease_until|lease_expires_at_ms/);
});

test("監査復元の競合検出とowner最後の一人保護は同じD1 mutationへ伝播する", () => {
  const restore = read("src/lib/audit/restore.ts");
  const adapters = read("src/lib/audit/adapters.ts");
  assert.match(restore, /computeChangedKeys\(after, current\)/);
  assert.match(restore, /conflicts\.length && !forceOverwrite/);
  assert.match(restore, /expectedCurrent: current/);
  assert.match(adapters, /export function expectedRowCondition/);
  assert.match(adapters, /Object\.entries\(expected\)/);
  assert.match(adapters, /sql\.join\(predicates, sql` AND `\)/);
  assert.match(adapters, /COUNT\(\*\).*permission_preset = 'owner'/s);
  assert.match(read("src/lib/audit/mutate.ts"), /changes\(\)/);
});

test("legacy previewはcanonical plan、行上限、期限、file/plan hashを固定する", () => {
  const plan = read("src/lib/import/legacy/plan.ts");
  const dryRun = read("src/lib/import/legacy/dryRun.ts");
  const route = read("app/api/admin/import/legacy/route.ts");
  assert.match(plan, /CanonicalEvent|CanonicalVideo|CanonicalEventStaff/);
  assert.match(plan, /permission_preset.*owner/);
  assert.match(dryRun, /previewRows\.length\s*<\s*MAX_PREVIEW_ROWS/);
  assert.match(route, /claims\.fileHash\s*!==\s*fileHash/);
  assert.match(route, /claims\.planHash\s*!==\s*planHash/);
  assert.match(route, /claims\.expiresAt\s*<\s*now/);
  assert.match(route, /claims\.anchorNow/);
});

test("Workerは3本のcanonical bindingだけを公開し、副作用endpointは共通認証を使う", () => {
  const checker = read("scripts/check-cloudflare-template.mjs");
  const auth = read("workers/shared/workerAdminAuth.ts");
  assert.deepEqual(
    [...checker.matchAll(/\["([a-z-]+)", \{ name:/g)].map((match) => match[1]),
    ["fast-jobs", "content-jobs", "sync-jobs"],
  );
  assert.match(checker, /binding\\s\*=/);
  for (const worker of ["fast-jobs", "content-jobs", "sync-jobs"]) {
    const toml = read(`workers/${worker}/wrangler.toml`);
    assert.match(toml, /binding\s*=\s*"DB"/);
    assert.match(toml, /binding\s*=\s*"KV"/);
  }
  assert.match(read("workers/content-jobs/wrangler.toml"), /binding\s*=\s*"R2"/);
  assert.match(auth, /request\.method !== "POST"/);
  assert.match(auth, /WORKER_ADMIN_TOKEN/);
  assert.match(auth, /MAX_WORKER_ADMIN_BODY_BYTES = 0/);
  assert.match(auth, /constantTimeEqual/);
});
