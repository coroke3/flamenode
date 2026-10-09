import test from "node:test";
import assert from "node:assert/strict";
import { expandDependencies, parseDecisionRows, parseTaskRows, validateMigrationExecution } from "./check-migration-execution.mjs";

const status = `Current Task: MIG-0301
Task State: READY
| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0108 | Gate | DONE | — |
| MIG-0301 | core PoC | READY | MIG-0108 |
| MIG-0302 | read | BLOCKED | MIG-0301 |
| MIG-0303 | mutate | BLOCKED | MIG-0302 |
| MIG-0304 | video | BLOCKED | MIG-0303 |
| MIG-0305 | event | BLOCKED | MIG-0303 |
| MIG-0306 | users | BLOCKED | MIG-0303 |
| MIG-0307 | Gate | BLOCKED | MIG-0304..MIG-0306 |
| MIG-0402 | Astro | BLOCKED | MIG-0301 |
| MIG-0405 | fence | BLOCKED | MIG-0301 |
| MIG-0406 | budget | BLOCKED | MIG-0405 |
| MIG-0605 | users api | BLOCKED | MIG-0307 |
| MIG-0701 | spa | BLOCKED | MIG-0307 |
| MIG-0702 | mutate spa | BLOCKED | MIG-0701 |
| MIG-0802 | auth | BLOCKED | MIG-0307 |
`;
const decisions = `| ID | Decision | State | Needed by |
| --- | --- | --- | --- |
| D-01 | schema | OPEN | MIG-0303 |
| D-02 | router | OPEN | MIG-0405 |
| D-03 | active x | OPEN | MIG-0605 |
| D-04 | writer | OPEN | MIG-0702 |
| D-05 | spa | PROVISIONAL | MIG-0701 |
| D-06 | scale | OPEN | MIG-0406 |
| D-07 | auth | PROVISIONAL | MIG-0802 |
| D-08 | mock | BLOCKED_ON_USER | MIG-0200 |
`;
const routing = "Phase 8まで /api/auth/* を旧Workerに維持。/api/* 一括切替は禁止。";
const vite = 'export default defineConfig({base: "/", build: {assetsDir:"_app_assets"}});';
const api = "CURRENT の `/api/*` パス構造";

function run(overrides = {}) {
  return validateMigrationExecution({ statusText: status, decisionsText: decisions, routingText: routing, viteText: vite, apiSpecText: api, ...overrides });
}

test("parse status task and decision inventory", () => {
  assert.equal(parseTaskRows(status).get("MIG-0301").state, "READY");
  assert.equal(parseDecisionRows(decisions).get("D-01"), "OPEN");
  assert.deepEqual(expandDependencies("MIG-0304..MIG-0306"), ["MIG-0304", "MIG-0305", "MIG-0306"]);
});

test("unrelated pure MIG-0301 can run before decisions", () => {
  assert.deepEqual(run(), []);
});

test("requires D-01 before MIG-0303 begins", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | DONE | MIG-0301 |")
                        .replace("| MIG-0301 | core PoC | READY | MIG-0108 |", "| MIG-0301 | core PoC | DONE | MIG-0108 |")
                        .replace("| MIG-0303 | mutate | BLOCKED | MIG-0302 |", "| MIG-0303 | mutate | READY | MIG-0302 |")
                        .replace("Current Task: MIG-0301", "Current Task: MIG-0303");
  assert.match(run({statusText: changed}).join("\n"), /D-01 is DECIDED/);
});

test("rejects unfinished dependencies for a READY task", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | READY | MIG-0301 |");
  assert.match(run({statusText: changed}).join("\n"), /unfinished dependency/);
});

test("rejects SPA base mismatch", () => {
  assert.match(run({viteText:'base: "/dashboard/"'}).join("\n"), /base '\/'/);
});

test("rejects catch-all routing or auth omission", () => {
  assert.match(run({routingText:"/api/* -> flamenode-api"}).join("\n"), /auth/);
});

test("requires known decision references", () => {
  assert.match(run({decisionsText: decisions.replace("| D-01 | schema | OPEN | MIG-0303 |", "")}).join("\n"), /missing decision/);
});
