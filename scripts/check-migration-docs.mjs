#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

const required = [
  "docs/migration/README.md",
  "docs/migration/AGENT_PROTOCOL.md",
  "docs/migration/GIT_WORKFLOW.md",
  "docs/migration/DOC_MAP.md",
  "docs/migration/STATUS.md",
  "docs/migration/FUNCTION_INVENTORY.md",
  "docs/migration/FRONTEND_FEATURES.md",
  "docs/migration/BACKEND_OPTIMIZATION.md",
  "docs/migration/ROUTE_MATRIX.md",
  "docs/migration/API_MATRIX.md",
  "docs/migration/functions/PUBLIC.md",
  "docs/migration/functions/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/functions/MANAGE_ADMIN.md",
  "docs/migration/functions/PLATFORM_API_JOBS.md",
  ".claude/commands/flamenode-migration.md",
  ".claude/loop.md",
  ".codex/skills/flamenode-migration/SKILL.md",
  ".codex/skills/loop/SKILL.md",
  ".agents/workflows/flamenode-migration.md",
  ".agents/skills/flamenode-migration/SKILL.md",
  ".agents/skills/loop/SKILL.md",
  ".agents/rules/flamenode-project.md",
];

const forbiddenDuplicates = [
  "docs/migration/PROGRESS.md",
  "docs/migration/WORK_ITEMS.md",
  "docs/migration/FEATURE_INVENTORY.md",
  "docs/migration/UI_FEATURE_INVENTORY.md",
  "docs/migration/OPTIMIZATION_NOTES.md",
];

function file(relative) {
  return path.join(root, relative);
}

function read(relative) {
  return fs.readFileSync(file(relative), "utf8");
}

for (const relative of required) {
  if (!fs.existsSync(file(relative))) errors.push(`missing required migration file: ${relative}`);
}
for (const relative of forbiddenDuplicates) {
  if (fs.existsSync(file(relative))) errors.push(`duplicate migration source of truth is forbidden: ${relative}`);
}

if (errors.length === 0) {
  const status = read("docs/migration/STATUS.md");
  const inventory = read("docs/migration/FUNCTION_INVENTORY.md");
  const frontend = read("docs/migration/FRONTEND_FEATURES.md");
  const optimization = read("docs/migration/BACKEND_OPTIMIZATION.md");
  const routeMatrix = read("docs/migration/ROUTE_MATRIX.md");
  const apiMatrix = read("docs/migration/API_MATRIX.md");
  const docMap = read("docs/migration/DOC_MAP.md");
  const gitWorkflow = read("docs/migration/GIT_WORKFLOW.md");

  const currentTask = status.match(/Current Task:\s*(MIG-\d{4})/i)?.[1];
  const nextAfterApproval = status.match(/Next after approval:\s*(MIG-\d{4})/i)?.[1];
  const currentOwner = status.match(/Current Owner:\s*([^\n]+)/i)?.[1]?.trim();
  const taskState = status.match(/Task State:\s*(READY|IN_PROGRESS|REVIEW|BLOCKED|DONE|SKIPPED)/i)?.[1];

  if (!currentTask) errors.push("STATUS.md: Current Task is missing");
  if (!currentOwner) errors.push("STATUS.md: Current Owner is missing");
  if (!taskState) errors.push("STATUS.md: Task State is missing or invalid");

  const taskRows = [...status.matchAll(/^\|\s*(MIG-\d{4})\s*\|/gm)].map((m) => m[1]);
  const taskSet = new Set(taskRows);
  if (taskSet.size !== taskRows.length) {
    const seen = new Set();
    const dupes = [...new Set(taskRows.filter((id) => seen.has(id) || !seen.add(id)))];
    errors.push(`STATUS.md: duplicate MIG task rows: ${dupes.join(", ")}`);
  }
  if (currentTask && !taskSet.has(currentTask)) errors.push(`STATUS.md: Current Task ${currentTask} has no task-table row`);
  if (nextAfterApproval && !taskSet.has(nextAfterApproval)) errors.push(`STATUS.md: Next after approval ${nextAfterApproval} has no task-table row`);

  const ledgerPaths = [
    "docs/migration/functions/PUBLIC.md",
    "docs/migration/functions/AUTH_PERSONAL_ENTRY.md",
    "docs/migration/functions/MANAGE_ADMIN.md",
    "docs/migration/functions/PLATFORM_API_JOBS.md",
  ];
  const functionRows = [];
  const validFunctionStates = new Set([
    "BASELINE_KNOWN",
    "DETAIL_AUDIT_REQUIRED",
    "CURRENT_VERIFIED",
    "MIGRATION_IN_PROGRESS",
    "BRIDGED",
    "PARITY_VERIFIED",
    "REMOVAL_PROPOSED",
    "REMOVED_APPROVED",
    "BLOCKED",
  ]);

  for (const ledgerPath of ledgerPaths) {
    const text = read(ledgerPath);
    for (const match of text.matchAll(/^\|\s*(FN-[A-Z]+-\d{3})\s*\|.*\|\s*([A-Z_]+)\s*\|\s*$/gm)) {
      functionRows.push({ id: match[1], state: match[2], ledgerPath });
      if (!validFunctionStates.has(match[2])) errors.push(`${ledgerPath}: invalid function state ${match[2]} for ${match[1]}`);
    }
  }

  const functionIds = functionRows.map((row) => row.id);
  const functionSet = new Set(functionIds);
  if (functionSet.size !== functionIds.length) {
    const seen = new Set();
    const dupes = [...new Set(functionIds.filter((id) => seen.has(id) || !seen.add(id)))];
    errors.push(`function ledger: duplicate IDs: ${dupes.join(", ")}`);
  }

  const declaredTotal = Number(inventory.match(/\*\*Total initial IDs\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/i)?.[1]);
  if (!Number.isFinite(declaredTotal)) errors.push("FUNCTION_INVENTORY.md: Total initial IDs is missing");
  else if (declaredTotal !== functionRows.length) errors.push(`FUNCTION_INVENTORY.md: declared total=${declaredTotal}, ledger rows=${functionRows.length}`);

  const stateCounts = functionRows.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});
  for (const state of ["CURRENT_VERIFIED", "DETAIL_AUDIT_REQUIRED", "PARITY_VERIFIED", "REMOVAL_PROPOSED", "REMOVED_APPROVED"]) {
    const reported = Number(status.match(new RegExp(`^${state}:\\s*(\\d+)`, "m"))?.[1]);
    const actual = stateCounts[state] ?? 0;
    if (!Number.isFinite(reported)) errors.push(`STATUS.md: ${state} count is missing`);
    else if (reported !== actual) errors.push(`STATUS.md: ${state} reported=${reported}, actual=${actual}`);
  }

  // Every frontend-exposed capability must be backed by one canonical function ID.
  const frontendIds = [...frontend.matchAll(/^\|\s*(FN-[A-Z]+-\d{3})\s*\|/gm)].map((m) => m[1]);
  const frontendSet = new Set(frontendIds);
  if (frontendSet.size !== frontendIds.length) {
    const seen = new Set();
    const dupes = [...new Set(frontendIds.filter((id) => seen.has(id) || !seen.add(id)))];
    errors.push(`FRONTEND_FEATURES.md: duplicate capability IDs: ${dupes.join(", ")}`);
  }
  for (const id of frontendSet) {
    if (!functionSet.has(id)) errors.push(`FRONTEND_FEATURES.md: capability ${id} has no matching function-ledger ID`);
  }
  const declaredFrontendTotal = Number(frontend.match(/^Total\s+(\d+)\s*$/m)?.[1]);
  if (!Number.isFinite(declaredFrontendTotal)) errors.push("FRONTEND_FEATURES.md: Total capability count is missing");
  else if (declaredFrontendTotal !== frontendSet.size) errors.push(`FRONTEND_FEATURES.md: declared total=${declaredFrontendTotal}, capability rows=${frontendSet.size}`);

  for (const requiredPhrase of [
    "frontend UX / functional parity / safety first",
    "UX_IMPACT_REVIEW_REQUIRED",
    "Optimization blockers requiring frontend change",
  ]) {
    if (!optimization.includes(requiredPhrase)) errors.push(`BACKEND_OPTIMIZATION.md: required policy phrase missing: ${requiredPhrase}`);
  }

  const knownMigs = new Set(taskRows);
  const migrationDocs = [inventory, routeMatrix, apiMatrix];
  const migrationNames = ["FUNCTION_INVENTORY.md", "ROUTE_MATRIX.md", "API_MATRIX.md"];
  migrationDocs.forEach((text, index) => {
    const refs = [...text.matchAll(/MIG-\d{4}/g)].map((m) => m[0]);
    for (const ref of new Set(refs)) {
      if (!knownMigs.has(ref)) errors.push(`${migrationNames[index]}: unknown task reference ${ref}`);
    }
  });

  for (const canonical of [
    "docs/migration/GIT_WORKFLOW.md",
    "docs/migration/STATUS.md",
    "docs/migration/FUNCTION_INVENTORY.md",
    "docs/migration/FRONTEND_FEATURES.md",
    "docs/migration/BACKEND_OPTIMIZATION.md",
    "docs/migration/ROUTE_MATRIX.md",
    "docs/migration/API_MATRIX.md",
  ]) {
    if (!docMap.includes(`\`${canonical}\``)) errors.push(`DOC_MAP.md: canonical source missing: ${canonical}`);
  }

  for (const phrase of [
    "1 MIG task = 1 branch = 1 PR = 1 merge unit",
    "squash merge",
    "Only one migration **writer lane** is active at a time",
    "Code landing and traffic switching are separate operations",
  ]) {
    if (!gitWorkflow.includes(phrase)) errors.push(`GIT_WORKFLOW.md: required policy phrase missing: ${phrase}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`[check:migration-docs] ${error}`);
  process.exit(1);
}

console.log("[check:migration-docs] OK: task state, function/capability ledgers, optimization policy, adapters, Git workflow, source map, and migration references are consistent.");
