import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const WORKER_SCAN_ROOTS = [
  "workers/content-jobs",
  "workers/fast-jobs",
  "workers/sync-jobs",
  "workers/json-generator",
  "workers/youtube-sync",
  "workers/notification-dispatcher",
  "workers/ga-analytics",
  "workers/score-recalc",
  "workers/cleanup",
  "workers/youtube-playlist-sync",
];

const FORBIDDEN_AUTO_COST_GUARD_PATTERNS = [
  /applyAutoCostGuard/,
  /auto_cost_guard/,
  /cost_usage_snapshot/,
  /cost_guard_thresholds/,
  /UPDATE\s+system_settings[\s\S]*operation_mode/i,
  /UPDATE\s+system_settings[\s\S]*disabled_features_json/i,
  /\.update\([^)]*operation_mode/,
  /\.update\([^)]*disabled_features_json/,
];

async function collectSourceFiles(rootRelative) {
  const absRoot = path.join(repoRoot, rootRelative);
  const names = await readdir(absRoot, { recursive: true });
  return names
    .filter((name) => typeof name === "string" && /\.(ts|tsx|mjs)$/.test(name))
    .map((name) => path.join(absRoot, name));
}

test("Cron/queue Workers do not mutate operation_mode or auto CostGuard state", async () => {
  const violations = [];
  for (const root of WORKER_SCAN_ROOTS) {
    for (const file of await collectSourceFiles(root)) {
      const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
      const source = await readFile(file, "utf8");
      for (const pattern of FORBIDDEN_AUTO_COST_GUARD_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${rel}: ${pattern}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("json-generator may read operation_mode but never writes it", async () => {
  const queue = await readFile(
    path.join(repoRoot, "workers/json-generator/queue.ts"),
    "utf8",
  );
  const queuePolicy = await readFile(
    path.join(repoRoot, "workers/json-generator/queuePolicy.ts"),
    "utf8",
  );
  assert.match(queue, /SELECT operation_mode FROM system_settings/);
  assert.doesNotMatch(queue, /UPDATE\s+system_settings/i);
  assert.doesNotMatch(queuePolicy, /UPDATE\s+system_settings/i);
  assert.doesNotMatch(queuePolicy, /operation_mode\s*:/);
});

test("runtime safety guards do not update operation_mode", async () => {
  const d1Budget = await readFile(
    path.join(repoRoot, "workers/shared/d1Budget.ts"),
    "utf8",
  );
  const youtubeQuota = await readFile(
    path.join(repoRoot, "workers/youtube-sync/quotaBudget.ts"),
    "utf8",
  );
  const dispatch = await readFile(
    path.join(repoRoot, "workers/notification-dispatcher/dispatch.ts"),
    "utf8",
  );
  const externalApi = await readFile(
    path.join(repoRoot, "workers/shared/externalApi.ts"),
    "utf8",
  );
  const queuePolicy = await readFile(
    path.join(repoRoot, "workers/json-generator/queuePolicy.ts"),
    "utf8",
  );
  const mutationPatterns = [
    /UPDATE\s+system_settings/i,
    /disabled_features_json/,
    /applyAutoCostGuard/,
    /system_settings\.operation_mode/,
    /operation_mode\s*=/,
  ];
  for (const source of [d1Budget, youtubeQuota, dispatch, externalApi, queuePolicy]) {
    for (const pattern of mutationPatterns) {
      assert.doesNotMatch(source, pattern);
    }
  }
  assert.match(queuePolicy, /operation_mode/);
});

test("writeGuard does not import runtime budget modules", async () => {
  const writeGuard = await readFile(
    path.join(repoRoot, "src/lib/auth/writeGuard.ts"),
    "utf8",
  );
  const writeGuardCore = await readFile(
    path.join(repoRoot, "src/lib/auth/writeGuardCore.ts"),
    "utf8",
  );
  const forbiddenImports = [
    /d1Budget/,
    /quotaBudget/,
    /ExternalRequestBudget/,
  ];
  for (const source of [writeGuard, writeGuardCore]) {
    for (const pattern of forbiddenImports) {
      assert.doesNotMatch(source, pattern);
    }
  }
});

test("only cost-guard Server Action writes operation_mode in actions/", async () => {
  const actionsRoot = path.join(repoRoot, "src/lib/actions");
  const files = (await readdir(actionsRoot, { recursive: true }))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  const writers = [];
  for (const name of files) {
    const source = await readFile(path.join(actionsRoot, name), "utf8");
    if (/operation_mode\s*:/.test(source) || /disabled_features_json\s*:/.test(source)) {
      writers.push(name);
    }
  }
  assert.deepEqual(writers, ["cost-guard.ts"]);
});

test("writeGuard reads operation_mode for gating but does not mutate it", async () => {
  const writeGuard = await readFile(
    path.join(repoRoot, "src/lib/auth/writeGuard.ts"),
    "utf8",
  );
  assert.match(writeGuard, /operation_mode: systemSettings\.operation_mode/);
  assert.match(writeGuard, /disabled_features_json: systemSettings\.disabled_features_json/);
  assert.doesNotMatch(writeGuard, /\.update\(/);
  assert.doesNotMatch(writeGuard, /mutateWithAudit/);
  assert.doesNotMatch(writeGuard, /UPDATE\s+system_settings/i);
});

test("spreadsheet import is the intentional admin path for disabled_features_json", async () => {
  const { resolveSpreadsheetTableDef, isSpreadsheetColumnEditable, SPREADSHEET_COST_GUARD_READONLY_COLUMNS } =
    await import("../admin/spreadsheet/registry.ts");
  const registry = await readFile(
    path.join(repoRoot, "src/lib/admin/spreadsheet/registry.ts"),
    "utf8",
  );
  assert.match(registry, /system_settings\.disabled_features_json/);
  assert.match(registry, /SPREADSHEET_COST_GUARD_READONLY_COLUMNS/);
  const def = resolveSpreadsheetTableDef("system_settings", true);
  for (const column of SPREADSHEET_COST_GUARD_READONLY_COLUMNS) {
    assert.equal(isSpreadsheetColumnEditable(def, column), false, column);
  }
  assert.equal(isSpreadsheetColumnEditable(def, "operation_mode"), false);
  assert.equal(isSpreadsheetColumnEditable(def, "disabled_features_json"), true);
});

test("spreadsheet query does not mutate operation_mode outside cost-guard", async () => {
  const query = await readFile(
    path.join(repoRoot, "src/lib/admin/spreadsheet/query.ts"),
    "utf8",
  );
  const forbiddenPatterns = [
    /operation_mode\s*:/,
    /SET\s+operation_mode/i,
    /\.set\(\s*\{[^}]*operation_mode/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(query, pattern, `query.ts must not write operation_mode: ${pattern}`);
  }
});
