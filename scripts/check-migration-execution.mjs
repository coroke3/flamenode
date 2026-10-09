#!/usr/bin/env node
// Migration workflow safety rules; do not silently downgrade gates on a failed check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_DECISIONS = Object.freeze({
  "MIG-0200": ["D-08"],
  "MIG-0308": ["D-01"],
  "MIG-0303": ["D-01"],
  "MIG-0304": ["D-01"],
  "MIG-0305": ["D-01"],
  "MIG-0306": ["D-01"],
  "MIG-0307": ["D-01"],
  "MIG-0402": ["D-08"],
  "MIG-0405": ["D-02"],
  "MIG-0406": ["D-06"],
  "MIG-0605": ["D-01", "D-03"],
  "MIG-0701": ["D-05"],
  "MIG-0702": ["D-03", "D-04"],
  "MIG-0802": ["D-07"],
});

const COMPLETED = new Set(["DONE", "SKIPPED"]);
const ACTIVE = new Set(["READY", "IN_PROGRESS", "REVIEW", "DONE"]);
const STATES = new Set(["READY", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE", "SKIPPED"]);

export function parseTaskRows(statusText) {
  const rows = new Map();
  for (const line of statusText.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6 || !/^MIG-\d{4}$/.test(cells[1])) continue;
    rows.set(cells[1], { state: cells[3], dependencies: cells[4], title: cells[2] });
  }
  return rows;
}

export function parseDecisionRows(decisionsText) {
  const decisions = new Map();
  for (const line of decisionsText.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !/^D-\d{2}$/.test(cells[1])) continue;
    decisions.set(cells[1], cells[3]);
  }
  return decisions;
}

export function expandDependencies(raw) {
  const deps = new Set();
  for (const part of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
    const range = part.match(/^(MIG-\d{4})\.\.(MIG-\d{4})$/);
    if (!range) {
      if (/^MIG-\d{4}$/.test(part)) deps.add(part);
      else if (!["—", "-", "user input"].includes(part)) throw new Error("unknown dependency syntax: " + part);
      continue;
    }
    const start = Number(range[1].slice(4));
    const end = Number(range[2].slice(4));
    if (end < start || end - start > 100) throw new Error("invalid dependency range: " + part);
    for (let n = start; n <= end; n++) deps.add("MIG-" + String(n).padStart(4, "0"));
  }
  return [...deps];
}

export function validateMigrationExecution({
  statusText, decisionsText, routingText, viteText, apiSpecText, activeXText, domainPlanText, privateSpaText, publicPlanText, uiReferenceText,
}) {
  const errors = [];
  const tasks = parseTaskRows(statusText);
  if (!tasks.has("MIG-0308")) errors.push("D-01=A requires MIG-0308 packages/db task");
  const decisions = parseDecisionRows(decisionsText);
  const currentTask = statusText.match(/^Current Task:\s*(MIG-\d{4})/m)?.[1];
  const currentState = statusText.match(/^Task State:\s*(\S+)/m)?.[1];

  if (!currentTask || !tasks.has(currentTask)) errors.push("current task is not in STATUS table");
  else if (tasks.get(currentTask).state !== currentState) errors.push("current task/header state mismatch");
  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const m of statusText.matchAll(/^\|\s*(MIG-\d{4})\s*\|/gm)) {
    if (seenIds.has(m[1])) duplicateIds.add(m[1]);
    seenIds.add(m[1]);
  }
  for (const id of duplicateIds) errors.push("duplicate task row: " + id);
  const dependencyGraph = new Map();
  for (const [id, row] of tasks) {
    if (!STATES.has(row.state)) errors.push(id + " invalid task state: " + row.state);
    if (row.state === "SKIPPED" && !new RegExp("^SKIP_APPROVAL: " + id + " \\| PR#[0-9]+ \\| APPROVAL=[^\\n|]+ \\| ALTERNATIVE=[^\\n|]+$", "m").test(statusText)) errors.push(id + " SKIPPED requires SKIP_APPROVAL with PR, reviewer and alternative");
    let deps = [];
    try { deps = expandDependencies(row.dependencies); }
    catch (error) { errors.push(id + ": " + error.message); }
    dependencyGraph.set(id, deps);
    for (const dep of deps) {
      if (!tasks.has(dep)) errors.push(id + " missing dependency " + dep);
      else if (ACTIVE.has(row.state) && !COMPLETED.has(tasks.get(dep).state)) errors.push(id + " has unfinished dependency " + dep);
    }
    for (const decision of REQUIRED_DECISIONS[id] || []) {
      if (!decisions.has(decision)) errors.push(id + " references missing decision " + decision);
      else if (ACTIVE.has(row.state) && decisions.get(decision) !== "DECIDED") {
        errors.push(id + " cannot be " + row.state + " until " + decision + " is DECIDED");
      }
    }
  }
  // BLOCKED tasks with cyclic dependencies must fail too.
  const visited = new Set();
  const visiting = new Set();
  const visitDependency = (id, chain = []) => {
    if (visiting.has(id)) { errors.push("dependency cycle: " + [...chain, id].join(" -> ")); return; }
    if (visited.has(id) || !dependencyGraph.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencyGraph.get(id)) visitDependency(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of dependencyGraph.keys()) visitDependency(id);
  if (viteText && !/base:\s*["']\/["']/.test(viteText)) {
    errors.push("Private SPA must use base '/' for /dashboard, /entry, /manage, /admin routes");
  }
  if (viteText && !viteText.includes('assetsDir: "_personal_assets"')) errors.push("Personal SPA asset namespace must be _personal_assets");
  if (routingText) {
    if (!routingText.includes("/api/auth/*") || !routingText.includes("一括切替は禁止")) {
      errors.push("routing must explicitly exclude legacy /api/auth/* from generic API cutover");
    }
    if (!routingText.includes("/_ops_assets/*") || !routingText.includes("/_personal_assets/*")) errors.push("2-SPA asset route namespaces are missing");
    if (/^-\s*\/api\/\*.*flamenode-api/m.test(routingText)) {
      errors.push("routing contains catch-all /api/* cutover");
    }
  }
  if (activeXText && (!activeXText.includes("link_role='owner'") || !activeXText.includes("fan-out"))) errors.push("D-03 requires approved owner X fan-out");
  if (domainPlanText && (!domainPlanText.includes("packages/db") || !domainPlanText.includes("ゼロDDL"))) errors.push("D-01 packages/db zero-DDL plan is missing");
  if (privateSpaText && (!privateSpaText.includes("apps/ops") || !privateSpaText.includes("/_ops_assets/*"))) errors.push("D-05 Ops SPA spec is missing");
  if (publicPlanText && (!publicPlanText.includes("R2") || !publicPlanText.includes("1102"))) errors.push("D-06 R2 HTML/CPU budget spec is missing");
  if (uiReferenceText && decisions.get("D-08") === "DECIDED" && uiReferenceText.includes("`PENDING_HTML`")) errors.push("D-08 cannot be DECIDED before mock registration");
  if (apiSpecText && !apiSpecText.includes("CURRENT の `/api/*` パス構造")) {
    errors.push("Hono plan must preserve CURRENT API path contract");
  }
  return errors;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = process.cwd();
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const errors = validateMigrationExecution({
    statusText: read("docs/migration/STATUS.md"),
    decisionsText: read("docs/migration/OPEN_DECISIONS.md"),
    routingText: read("docs/migration/ROUTING_AND_DEPLOY_PLAN.md"),
    viteText: read("apps/app/vite.config.ts"),
    apiSpecText: read("docs/migration/PHASE_6_SPEC.md"),
    activeXText: read("docs/migration/ACTIVE_X_MIGRATION_PLAN.md"),
    domainPlanText: read("docs/migration/DB_PACKAGE_EXTRACTION_PLAN.md"),
    privateSpaText: read("docs/migration/PHASE_7_SPEC.md"),
    publicPlanText: read("docs/migration/PHASE_4_5_SPEC.md"),
    uiReferenceText: read("docs/migration/UI_REFERENCE.md"),
  });
  if (errors.length) {
    for (const error of errors) console.error("[check:migration-execution] " + error);
    process.exitCode = 1;
  } else console.log("[check:migration-execution] OK");
}
