import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertLegacyImportPlanLimits,
  planLegacyImportQueryBudget,
} from "./plan.ts";

const emptyPlan = () => ({
  events: [], eventStaff: [], eventCustomQuestions: [], videos: [], videoEvents: [],
  videoMembers: [], videoCustomAnswers: [], videoNormExtras: [], xUsers: [],
  youtubeMetadata: [], warnings: [], errors: [], stats: {},
});

test("query plannerは最大entity planでもanalyze/applyを50 query以内に保つ", () => {
  const plan = emptyPlan();
  plan.events = Array.from({ length: 4 }, (_, id) => ({ id: `e${id}` }));
  plan.videos = Array.from({ length: 4 }, (_, id) => ({ id: `v${id}` }));
  plan.xUsers = Array.from({ length: 16 }, (_, id) => ({ id: `x${id}` }));
  assert.deepEqual(planLegacyImportQueryBudget(plan, "replace_imported", "analyze"), {
    phase: "analyze", preflightQueries: 21, finalizeReserve: 0,
    totalQueries: 21, limit: 50, withinLimit: true,
  });
  assert.deepEqual(planLegacyImportQueryBudget(plan, "replace_imported", "apply"), {
    phase: "apply", preflightQueries: 29, finalizeReserve: 20,
    totalQueries: 49, limit: 50, withinLimit: true,
  });
});

test("entity hard cap超過はDB write前に使えるpure検査で拒否する", () => {
  const plan = emptyPlan();
  plan.videoMembers = Array.from({ length: 101 }, (_, id) => ({ id }));
  assert.throws(
    () => assertLegacyImportPlanLimits(plan, "skip_existing", "analyze"),
    /legacy_import_entity_cap_exceeded:videoMembers:101\/100/,
  );
});

test("version/dry-run queryはPromise query列を使わずIN集合queryを維持する", () => {
  const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  const route = read("../../../../app/api/admin/import/legacy/route.ts");
  const dryRun = read("./dryRun.ts");
  const apply = read("./apply.ts");
  assert.doesNotMatch(route.slice(route.indexOf("async function captureTargetVersions"), route.indexOf("function isTargetVersion")), /Promise\.all/);
  assert.doesNotMatch(dryRun, /Promise\.all/);
  assert.doesNotMatch(apply, /args\.db\.select\(\)\.from\(videoMembers\)/);
  assert.match(apply, /allVideoMembers[\s\S]*inArray\(videoMembers\.video_id, videoIds\)/);
  assert.match(route, /where\(inArray\(videoMembers\.video_id, ids\)\)/);
  assert.match(route, /assertLegacyImportPlanLimits\(plan, strategy, action\)/);
});

test("finalizeの既存audit/batch上限と単一mutate契約を維持する", () => {
  const source = readFileSync(fileURLToPath(new URL("./apply.ts", import.meta.url)), "utf8");
  assert.match(source, /audits\.length > MAX_D1_AUDIT_ENTRIES/);
  assert.match(source, /mutationStatements\.length \+ assertionCount \+ 4 > MAX_D1_BATCH_STATEMENTS/);
  assert.equal((source.match(/await mutateWithAudit\(db,/g) ?? []).length, 1);
});
