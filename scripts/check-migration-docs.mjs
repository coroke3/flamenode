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
  "docs/migration/CURRENT_ROUTES.md",
  "docs/migration/FRONTEND_FEATURES.md",
  "docs/migration/FUNCTION_INVENTORY.md",
  "docs/migration/PRODUCT_REQUIREMENTS.md",
  "docs/migration/CODE_QUALITY.md",
  "docs/migration/UI_REFERENCE.md",
  "docs/migration/BACKEND_OPTIMIZATION.md",
  "docs/migration/ROUTE_MATRIX.md",
  "docs/migration/API_MATRIX.md",
  "docs/migration/server-actions/README.md",
  "docs/migration/route-handlers/README.md",
  "docs/migration/frontend/CROSS_CUTTING.md",
  "docs/migration/frontend/PUBLIC.md",
  "docs/migration/frontend/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/frontend/MANAGE_ADMIN.md",
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

const forbidden = [
  "docs/migration/PROGRESS.md",
  "docs/migration/WORK_ITEMS.md",
  "docs/migration/FEATURE_INVENTORY.md",
  "docs/migration/UI_FEATURE_INVENTORY.md",
  "docs/migration/OPTIMIZATION_NOTES.md",
  "docs/design-redesign",
];

const functionLedgers = [
  "docs/migration/functions/PUBLIC.md",
  "docs/migration/functions/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/functions/MANAGE_ADMIN.md",
  "docs/migration/functions/PLATFORM_API_JOBS.md",
];

const uxLedgers = [
  "docs/migration/frontend/CROSS_CUTTING.md",
  "docs/migration/frontend/PUBLIC.md",
  "docs/migration/frontend/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/frontend/MANAGE_ADMIN.md",
];

function file(relative) {
  return path.join(root, relative);
}

function read(relative) {
  return fs.readFileSync(file(relative), "utf8");
}

function duplicateIds(ids) {
  const seen = new Set();
  const dupes = new Set();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

for (const relative of required) {
  if (!fs.existsSync(file(relative))) errors.push(`missing required migration file: ${relative}`);
}

for (const relative of forbidden) {
  if (fs.existsSync(file(relative))) errors.push(`forbidden/duplicate migration source exists: ${relative}`);
}

if (errors.length === 0) {
  const status = read("docs/migration/STATUS.md");
  const architecture = read("docs/migration/README.md");
  const protocol = read("docs/migration/AGENT_PROTOCOL.md");
  const inventory = read("docs/migration/FUNCTION_INVENTORY.md");
  const frontend = read("docs/migration/FRONTEND_FEATURES.md");
  const currentRoutes = read("docs/migration/CURRENT_ROUTES.md");
  const requirements = read("docs/migration/PRODUCT_REQUIREMENTS.md");
  const quality = read("docs/migration/CODE_QUALITY.md");
  const uiReference = read("docs/migration/UI_REFERENCE.md");
  const optimization = read("docs/migration/BACKEND_OPTIMIZATION.md");
  const routeMatrix = read("docs/migration/ROUTE_MATRIX.md");
  const apiMatrix = read("docs/migration/API_MATRIX.md");
  const docMap = read("docs/migration/DOC_MAP.md");
  const gitWorkflow = read("docs/migration/GIT_WORKFLOW.md");

  // Progress/task integrity.
  const currentTask = status.match(/Current Task:\s*(MIG-\d{4})/i)?.[1];
  const currentOwner = status.match(/Current Owner:\s*([^\n]+)/i)?.[1]?.trim();
  const taskState = status.match(/Task State:\s*(READY|IN_PROGRESS|REVIEW|BLOCKED|DONE|SKIPPED)/i)?.[1];

  if (!currentTask) errors.push("STATUS.md: Current Task is missing");
  if (!currentOwner) errors.push("STATUS.md: Current Owner is missing");
  if (!taskState) errors.push("STATUS.md: Task State is missing or invalid");

  const taskRows = [...status.matchAll(/^\|\s*(MIG-\d{4})\s*\|/gm)].map((m) => m[1]);
  const taskSet = new Set(taskRows);
  const taskDupes = duplicateIds(taskRows);
  if (taskDupes.length) errors.push(`STATUS.md: duplicate MIG task rows: ${taskDupes.join(", ")}`);
  if (currentTask && !taskSet.has(currentTask)) errors.push(`STATUS.md: Current Task ${currentTask} has no task-table row`);

  // CURRENT route baseline must remain 86 user-visible screens.
  const routeSectionCounts = [...currentRoutes.matchAll(/^##\s+(Public|Personal|Entry|Manage|Admin|System)\s+—\s+(\d+)\s*$/gm)]
    .map((m) => Number(m[2]));
  const routeBaselineTotal = routeSectionCounts.reduce((sum, count) => sum + count, 0);
  if (routeSectionCounts.length !== 6) errors.push(`CURRENT_ROUTES.md: expected 6 USER_SCREEN section counts, found ${routeSectionCounts.length}`);
  if (routeBaselineTotal !== 86) errors.push(`CURRENT_ROUTES.md: USER_SCREEN section total=${routeBaselineTotal}, expected=86`);
  if (!/CURRENT USER_SCREEN routes\s*\|\s*86\s*\|/m.test(status)) errors.push("STATUS.md: CURRENT USER_SCREEN baseline must report 86");

  // Backend/domain/platform FN ledgers.
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
  const functionRows = [];

  for (const ledgerPath of functionLedgers) {
    const text = read(ledgerPath);
    for (const match of text.matchAll(/^\|\s*(FN-[A-Z]+-\d{3})\s*\|.*\|\s*([A-Z_]+)\s*\|\s*$/gm)) {
      const row = { id: match[1], state: match[2], ledgerPath };
      functionRows.push(row);
      if (!validFunctionStates.has(row.state)) errors.push(`${ledgerPath}: invalid function state ${row.state} for ${row.id}`);
    }
  }

  const functionIds = functionRows.map((row) => row.id);
  const functionSet = new Set(functionIds);
  const functionDupes = duplicateIds(functionIds);
  if (functionDupes.length) errors.push(`function ledgers: duplicate IDs: ${functionDupes.join(", ")}`);

  const declaredFunctionTotal = Number(inventory.match(/\*\*Total initial IDs\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/i)?.[1]);
  if (!Number.isFinite(declaredFunctionTotal)) errors.push("FUNCTION_INVENTORY.md: Total initial IDs is missing");
  else if (declaredFunctionTotal !== functionRows.length) errors.push(`FUNCTION_INVENTORY.md: declared total=${declaredFunctionTotal}, ledger rows=${functionRows.length}`);
  if (functionRows.length !== 136) errors.push(`function ledgers: current baseline=${functionRows.length}, expected=136`);

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

  // Frontend observable UX ledgers. UX and FN are intentionally many-to-many.
  const validUxStates = new Set([
    "CURRENT_OBSERVED",
    "AUDIT_REQUIRED",
    "CURRENT_VERIFIED",
    "REQUIREMENT_ONLY",
    "CURRENT_DIVERGENCE",
    "PARITY_VERIFIED",
    "REMOVAL_PROPOSED",
    "REMOVED_APPROVED",
    "BLOCKED",
  ]);
  const uxRows = [];

  for (const ledgerPath of uxLedgers) {
    const text = read(ledgerPath);
    for (const line of text.split("\n")) {
      const id = line.match(/^\|\s*(UX-[A-Z]+-\d{3})\s*\|/)?.[1];
      if (!id) continue;

      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      const state = cells.at(-1);
      uxRows.push({ id, state, ledgerPath, line });
      if (!validUxStates.has(state)) errors.push(`${ledgerPath}: invalid UX evidence/state ${state} for ${id}`);

      const fnRefs = [...line.matchAll(/FN-[A-Z]+-\d{3}/g)].map((m) => m[0]);
      for (const fnId of new Set(fnRefs)) {
        if (!functionSet.has(fnId)) errors.push(`${ledgerPath}: ${id} references unknown function ${fnId}`);
      }
    }
  }

  const uxIds = uxRows.map((row) => row.id);
  const uxDupes = duplicateIds(uxIds);
  if (uxDupes.length) errors.push(`frontend UX ledgers: duplicate IDs: ${uxDupes.join(", ")}`);

  const declaredUxTotal = Number(frontend.match(/\*\*Total baseline\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/i)?.[1]);
  if (!Number.isFinite(declaredUxTotal)) errors.push("FRONTEND_FEATURES.md: Total baseline count is missing");
  else if (declaredUxTotal !== uxRows.length) errors.push(`FRONTEND_FEATURES.md: declared total=${declaredUxTotal}, UX ledger rows=${uxRows.length}`);
  if (uxRows.length !== 432) errors.push(`frontend UX ledgers: current baseline=${uxRows.length}, expected=432`);
  if (!/Frontend `UX-\*` capabilities\s*\|\s*432\s*\|/m.test(status)) errors.push("STATUS.md: frontend UX baseline must report 432");


  // MIG-0003 Server Action completeness: real code <-> ledger.
  const serverActions = read("docs/migration/server-actions/README.md");
  const ledgerRows = [...serverActions.matchAll(/^\|\s*(SA-\d{3})\s*\|\s*\x60([^\x60]+)\x60\s*\|/gm)]
    .map((m) => ({ id: m[1], source: m[2] }));
  if (ledgerRows.length !== 110) errors.push(`server-actions ledger: rows=${ledgerRows.length}, expected=110`);

  const actionFiles = walkFiles(file("src/lib/actions"), (p) =>
    p.endsWith(".ts") && !p.includes(".test.") && !p.includes(".contract.") && !p.includes(".execution.")
  );
  const discoveredModuleActions = [];
  let useServerModules = 0;
  for (const abs of actionFiles) {
    const sourceText = fs.readFileSync(abs, "utf8");
    if (!/^\s*["']use server["'];/m.test(sourceText)) continue;
    useServerModules++;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    for (const match of sourceText.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      discoveredModuleActions.push(`${rel}#${match[1]}`);
    }
  }
  if (useServerModules !== 34) errors.push(`Server Action modules: actual=${useServerModules}, expected=34`);
  if (discoveredModuleActions.length !== 106) errors.push(`exported Server Actions: actual=${discoveredModuleActions.length}, expected=106`);

  const ledgerModuleSources = new Set(ledgerRows.filter((r) => r.source.startsWith("src/lib/actions/")).map((r) => r.source));
  for (const source of discoveredModuleActions) if (!ledgerModuleSources.has(source)) errors.push(`server-actions ledger missing code export: ${source}`);
  for (const source of ledgerModuleSources) if (!discoveredModuleActions.includes(source)) errors.push(`server-actions ledger stale/unknown export: ${source}`);

  const appFiles = walkFiles(file("app"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"));
  let inlineUseServer = 0;
  for (const abs of appFiles) {
    const sourceText = fs.readFileSync(abs, "utf8");
    const moduleDirective = /^\s*["']use server["'];/m.test(sourceText);
    const count = (sourceText.match(/["']use server["'];/g) ?? []).length;
    inlineUseServer += moduleDirective ? Math.max(0, count - 1) : count;
  }
  const inlineLedgerCount = ledgerRows.filter((r) => r.source.startsWith("app/")).length;
  if (inlineUseServer !== 4) errors.push(`inline Server Actions: actual=${inlineUseServer}, expected=4`);
  if (inlineLedgerCount !== inlineUseServer) errors.push(`server-actions ledger inline rows=${inlineLedgerCount}, code inline actions=${inlineUseServer}`);

  // MIG-0004 Route Handler completeness: real code <-> ledger.
  const routeHandlers = read("docs/migration/route-handlers/README.md");
  const routeHandlerRows = [...routeHandlers.matchAll(/^\|\s*(RH-\d{3})\s*\|\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\|\s*([^|]+?)\s*\|/gm)]
    .map((m) => ({ id: m[1], method: m[2], route: m[3].trim() }));
  if (routeHandlerRows.length !== 33) errors.push(`route-handler ledger: rows=${routeHandlerRows.length}, expected=33`);

  const routeFiles = walkFiles(file("app/api"), (p) => p.endsWith(path.sep + "route.ts"));
  if (routeFiles.length !== 28) errors.push(`Route Handler files: actual=${routeFiles.length}, expected=28`);

  const discoveredRouteHandlers = [];
  for (const abs of routeFiles) {
    const sourceText = fs.readFileSync(abs, "utf8");
    const rel = path.relative(file("app"), abs).split(path.sep).join("/");
    const route = "/" + rel.replace(/\/route\.ts$/, "");
    const methods = new Set();
    for (const match of sourceText.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) methods.add(match[1]);
    for (const match of sourceText.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) methods.add(match[1]);
    for (const match of sourceText.matchAll(/export\s+const\s*\{([^}]+)\}/g)) {
      for (const raw of match[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/).at(-1);
        if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) methods.add(name);
      }
    }
    for (const method of methods) discoveredRouteHandlers.push(`${method} ${route}`);
  }
  if (discoveredRouteHandlers.length !== 33) errors.push(`HTTP method handlers: actual=${discoveredRouteHandlers.length}, expected=33`);

  const ledgerPairs = new Set(routeHandlerRows.map((r) => `${r.method} ${r.route}`));
  for (const pair of discoveredRouteHandlers) if (!ledgerPairs.has(pair)) errors.push(`route-handler ledger missing code handler: ${pair}`);
  for (const pair of ledgerPairs) if (!discoveredRouteHandlers.includes(pair)) errors.push(`route-handler ledger stale/unknown handler: ${pair}`);
  // Design source transition.
  if (!uiReference.includes("`PENDING_HTML`")) errors.push("UI_REFERENCE.md: PENDING_HTML state is missing");
  if (!uiReference.includes("ユーザーが後日提供するHTML mock")) errors.push("UI_REFERENCE.md: later user-provided HTML mock contract is missing");

  const obsoletePositiveRefs = [
    "docs/design-redesign/ROUTE_INVENTORY.md",
    "docs/design-redesign/PAGE_COVERAGE.md",
    "docs/design-redesign/DESIGN_PRINCIPLES.md",
    "docs/design-redesign/UX_AUDIT.md",
    "docs/design-redesign/NAVIGATION.md",
    "design-redesign/README.md",
  ];
  const authoritativeTexts = [
    architecture,
    protocol,
    inventory,
    frontend,
    routeMatrix,
    docMap,
    read("AGENTS.md"),
    read("docs/AI_CONTEXT.md"),
    read("docs/README.md"),
  ];
  for (const obsolete of obsoletePositiveRefs) {
    if (authoritativeTexts.some((text) => text.includes(obsolete))) errors.push(`obsolete visual source reference remains: ${obsolete}`);
  }

  if (!routeMatrix.includes("CURRENT_ROUTES.md")) errors.push("ROUTE_MATRIX.md: CURRENT route source must be CURRENT_ROUTES.md");
  if (!routeMatrix.includes("432 baseline `UX-*`")) errors.push("ROUTE_MATRIX.md: 432 UX mapping contract is missing");
  for (const stale of [
    "89 frontend capabilities",
    "89 capabilities total",
    "app/(redesign)/dev/redesign/_catalog.ts",
  ]) {
    if (routeMatrix.includes(stale)) errors.push(`ROUTE_MATRIX.md: stale redesign/count reference remains: ${stale}`);
  }

  // Requirement, optimization and code quality policies.
  for (const phrase of ["CURRENT_DIVERGENCE", "REQUIREMENT_ONLY", "CURRENT behavior"]) {
    if (!requirements.includes(phrase)) errors.push(`PRODUCT_REQUIREMENTS.md: required policy phrase missing: ${phrase}`);
  }

  for (const phrase of ["experienced production engineer", "コード行数削減はKPIではない", "framework adapter", "Side effects"]) {
    if (!quality.includes(phrase)) errors.push(`CODE_QUALITY.md: required quality phrase missing: ${phrase}`);
  }

  for (const requiredPhrase of [
    "frontend UX / functional parity / safety first",
    "UX_IMPACT_REVIEW_REQUIRED",
    "Optimization blockers requiring frontend change",
  ]) {
    if (!optimization.includes(requiredPhrase)) errors.push(`BACKEND_OPTIMIZATION.md: required policy phrase missing: ${requiredPhrase}`);
  }

  // Cross-document MIG references must point to tracked tasks.
  const knownMigs = new Set(taskRows);
  const migrationDocs = [architecture, inventory, routeMatrix, apiMatrix];
  const migrationNames = ["README.md", "FUNCTION_INVENTORY.md", "ROUTE_MATRIX.md", "API_MATRIX.md"];
  migrationDocs.forEach((text, index) => {
    const refs = [...text.matchAll(/MIG-\d{4}/g)].map((m) => m[0]);
    for (const ref of new Set(refs)) {
      if (!knownMigs.has(ref)) errors.push(`${migrationNames[index]}: unknown task reference ${ref}`);
    }
  });

  // Source map must contain every canonical migration source.
  for (const canonical of [
    "docs/migration/GIT_WORKFLOW.md",
    "docs/migration/STATUS.md",
    "docs/migration/CURRENT_ROUTES.md",
    "docs/migration/FRONTEND_FEATURES.md",
    "docs/migration/FUNCTION_INVENTORY.md",
    "docs/migration/PRODUCT_REQUIREMENTS.md",
    "docs/migration/CODE_QUALITY.md",
    "docs/migration/UI_REFERENCE.md",
    "docs/migration/BACKEND_OPTIMIZATION.md",
    "docs/migration/ROUTE_MATRIX.md",
    "docs/migration/API_MATRIX.md",
    "docs/migration/server-actions/README.md",
    "docs/migration/route-handlers/README.md",
  ]) {
    if (!docMap.includes("`" + canonical + "`")) errors.push(`DOC_MAP.md: canonical source missing: ${canonical}`);
  }

  // Shared protocol must force Git, requirements, quality and visual-source rules.
  for (const canonical of ["GIT_WORKFLOW.md", "PRODUCT_REQUIREMENTS.md", "CODE_QUALITY.md", "CURRENT_ROUTES.md", "UI_REFERENCE.md", "server-actions/README.md", "route-handlers/README.md"]) {
    if (!protocol.includes(canonical)) errors.push(`AGENT_PROTOCOL.md: mandatory source missing: ${canonical}`);
  }

  // Tool adapters must delegate to the shared protocol.
  const adapters = [
    ".claude/commands/flamenode-migration.md",
    ".codex/skills/flamenode-migration/SKILL.md",
    ".agents/workflows/flamenode-migration.md",
    ".agents/skills/flamenode-migration/SKILL.md",
    ".agents/rules/flamenode-project.md",
  ];
  for (const adapter of adapters) {
    if (!read(adapter).includes("AGENT_PROTOCOL.md")) errors.push(`${adapter}: must delegate to AGENT_PROTOCOL.md`);
  }

  const antigravityRule = read(".agents/rules/flamenode-project.md");
  for (const phrase of ["GIT_WORKFLOW.md", "PRODUCT_REQUIREMENTS.md", "CODE_QUALITY.md", "UI_REFERENCE.md", "server-actions/README.md", "route-handlers/README.md"]) {
    if (!antigravityRule.includes(phrase)) errors.push(`Antigravity rule: required source missing: ${phrase}`);
  }

  // Git discipline remains non-negotiable.
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

console.log("[check:migration-docs] OK: 86 CURRENT routes, 432 UX capabilities, 136 FN contracts, 110 Server Actions, 28 API route files / 33 handlers, route/UI sources, quality/agent/Git rules and task references are consistent.");
