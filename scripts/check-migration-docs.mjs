#!/usr/bin/env node
import fs from "node:fs";
import { validateMigrationExecution } from "./check-migration-execution.mjs";
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
  "docs/migration/FEATURE_CATALOG.md",
  "docs/migration/FUNCTION_INVENTORY.md",
  "docs/migration/PRODUCT_REQUIREMENTS.md",
  "docs/migration/CODE_QUALITY.md",
  "docs/migration/UI_REFERENCE.md",
  "docs/migration/BACKEND_OPTIMIZATION.md",
  "docs/migration/ROUTE_MATRIX.md",
  "docs/migration/API_MATRIX.md",
  "docs/migration/server-actions/README.md",
  "docs/migration/route-handlers/README.md",
  "docs/migration/cloudflare/TOPOLOGY.md",
  "docs/migration/cloudflare/PERFORMANCE_BASELINE.md",
  "docs/migration/static-delivery/README.md",
  "docs/migration/auth/README.md",
  "docs/migration/background-jobs/README.md",
  "docs/migration/gap-scan/BACKEND_FN_OPTIMIZATION.md",
  "docs/migration/screen-mapping/README.md",
  "docs/migration/gap-scan/FRONTEND_REQUIREMENTS.md",
  "docs/migration/frontend/CROSS_CUTTING.md",
  "docs/migration/frontend/PUBLIC.md",
  "docs/migration/frontend/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/frontend/MANAGE_ADMIN.md",
  "docs/migration/functions/PUBLIC.md",
  "docs/migration/functions/AUTH_PERSONAL_ENTRY.md",
  "docs/migration/functions/MANAGE_ADMIN.md",
  "docs/migration/functions/PLATFORM_API_JOBS.md",
  "docs/migration/OPEN_DECISIONS.md",
  "docs/migration/PHASE_1_SPEC.md",
  "docs/migration/PHASE_3_SPEC.md",
  "docs/migration/PHASE_4_5_SPEC.md",
  "docs/migration/PHASE_6_SPEC.md",
  "docs/migration/PHASE_7_SPEC.md",
  "docs/migration/PHASE_8_9_SPEC.md",
  "docs/migration/ACTIVE_X_MIGRATION_PLAN.md",
  "docs/migration/ROUTING_AND_DEPLOY_PLAN.md",
  "docs/migration/UI_MIGRATION_GUIDE.md",
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
  const featureCatalog = read("docs/migration/FEATURE_CATALOG.md");
  const currentRoutes = read("docs/migration/CURRENT_ROUTES.md");
  const requirements = read("docs/migration/PRODUCT_REQUIREMENTS.md");
  const quality = read("docs/migration/CODE_QUALITY.md");
  const uiReference = read("docs/migration/UI_REFERENCE.md");
  const optimization = read("docs/migration/BACKEND_OPTIMIZATION.md");
  const routeMatrix = read("docs/migration/ROUTE_MATRIX.md");
  const apiMatrix = read("docs/migration/API_MATRIX.md");
  const docMap = read("docs/migration/DOC_MAP.md");
  const gitWorkflow = read("docs/migration/GIT_WORKFLOW.md");
  const cloudflareTopology = read("docs/migration/cloudflare/TOPOLOGY.md");
  const performanceBaseline = read("docs/migration/cloudflare/PERFORMANCE_BASELINE.md");
  const staticDeliveryBaseline = read("docs/migration/static-delivery/README.md");
  const authBaseline = read("docs/migration/auth/README.md");
  const backgroundJobsBaseline = read("docs/migration/background-jobs/README.md");
  const backendFnOptimization = read("docs/migration/gap-scan/BACKEND_FN_OPTIMIZATION.md");
  const screenMapping = read("docs/migration/screen-mapping/README.md");
  const frontendRequirements = read("docs/migration/gap-scan/FRONTEND_REQUIREMENTS.md");

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

  // CURRENT page-route totals are derived from source, not frozen to the historical 86-screen baseline.
  // Backend/domain/platform FN ledgers.
  const validFunctionStates = new Set([
    "BASELINE_KNOWN",
    "DETAIL_AUDIT_REQUIRED",
    "CURRENT_VERIFIED",
    "CURRENT_DIVERGENCE",
    "OBSOLETE",
    "MERGED_INTO_OTHER",
    "TARGET_REDESIGN_REQUIRED",
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

  // MIG-0011 has parallel writer lanes. Backend/frontend lanes must not edit STATUS.md;
  // the integration lane updates summary counts after both PRs land. Outside an active
  // MIG-0011 checkpoint, STATUS counts still have to match the canonical ledgers.
  const allowMig0011CheckpointStatusCounts =
    currentTask === "MIG-0011" && taskState !== "DONE";
  if (!allowMig0011CheckpointStatusCounts) {
    for (const state of ["CURRENT_VERIFIED", "DETAIL_AUDIT_REQUIRED", "PARITY_VERIFIED", "REMOVAL_PROPOSED", "REMOVED_APPROVED"]) {
      const reported = Number(status.match(new RegExp(`^${state}:\\s*(\\d+)`, "m"))?.[1]);
      const actual = stateCounts[state] ?? 0;
      if (!Number.isFinite(reported)) errors.push(`STATUS.md: ${state} count is missing`);
      else if (reported !== actual) errors.push(`STATUS.md: ${state} reported=${reported}, actual=${actual}`);
    }
  }

  const finalFunctionStates = new Set([
    "CURRENT_VERIFIED",
    "CURRENT_DIVERGENCE",
    "OBSOLETE",
    "MERGED_INTO_OTHER",
    "TARGET_REDESIGN_REQUIRED",
    "PARITY_VERIFIED",
    "REMOVED_APPROVED",
  ]);
  if ((stateCounts.DETAIL_AUDIT_REQUIRED ?? 0) !== 0) {
    errors.push(`function ledgers: DETAIL_AUDIT_REQUIRED=${stateCounts.DETAIL_AUDIT_REQUIRED ?? 0}, expected=0 after backend MIG-0011 audit`);
  }
  const nonFinalFunctions = functionRows.filter((row) => !finalFunctionStates.has(row.state));
  if (nonFinalFunctions.length > 0) {
    errors.push(`function ledgers: final disposition missing for ${nonFinalFunctions.map((row) => row.id).join(", ")}`);
  }

  // MIG-0011 backend final-audit completeness. Parse only the final 136 index so
  // detailed 103-row evidence earlier in the document does not count as duplicates.
  const finalIndexStart = backendFnOptimization.indexOf("## Final 136 FN disposition index");
  const finalIndexEnd = backendFnOptimization.indexOf("## Active X backend migration assessment");
  if (finalIndexStart < 0 || finalIndexEnd <= finalIndexStart) {
    errors.push("BACKEND_FN_OPTIMIZATION.md: final 136 FN disposition index is missing");
  } else {
    const finalIndexText = backendFnOptimization.slice(finalIndexStart, finalIndexEnd);
    const auditFnRows = [...finalIndexText.matchAll(/^\|\s*(FN-[A-Z]+-\d{3})\s*\|\s*([A-Z_]+)\s*\|\s*$/gm)]
      .map((match) => ({ id: match[1], state: match[2] }));
    const auditFnIds = auditFnRows.map((row) => row.id);
    const auditFnSet = new Set(auditFnIds);
    const auditDupes = duplicateIds(auditFnIds);
    if (auditDupes.length) errors.push(`BACKEND_FN_OPTIMIZATION.md: duplicate final-index FN IDs: ${auditDupes.join(", ")}`);
    if (auditFnRows.length !== functionRows.length) {
      errors.push(`BACKEND_FN_OPTIMIZATION.md: final-index rows=${auditFnRows.length}, expected=${functionRows.length}`);
    }
    for (const row of functionRows) {
      if (!auditFnSet.has(row.id)) errors.push(`BACKEND_FN_OPTIMIZATION.md: orphan FN missing from final index: ${row.id}`);
      const reported = auditFnRows.find((candidate) => candidate.id === row.id);
      if (reported && reported.state !== row.state) {
        errors.push(`BACKEND_FN_OPTIMIZATION.md: ${row.id} state=${reported.state}, ledger=${row.state}`);
      }
    }
    for (const row of auditFnRows) {
      if (!functionSet.has(row.id)) errors.push(`BACKEND_FN_OPTIMIZATION.md: unknown FN reference in final index: ${row.id}`);
    }
  }

  const optimizationStart = backendFnOptimization.indexOf("## Duplicate / obsolete / commonization final scan");
  const optimizationEnd = backendFnOptimization.indexOf("### Obsolete/meaning-thin processing conclusions");
  if (optimizationStart < 0 || optimizationEnd <= optimizationStart) {
    errors.push("BACKEND_FN_OPTIMIZATION.md: optimization disposition table is missing");
  } else {
    const optimizationText = backendFnOptimization.slice(optimizationStart, optimizationEnd);
    const optimizationRows = [...optimizationText.matchAll(
      /^\|\s*(OPT-BE-\d{3})\s*\|[^|]+\|\s*(KEEP|MERGE|REMOVE|TARGET_REWRITE|INTENTIONAL_EXCEPTION)\s*\|\s*(NONE|OPTIONAL|REQUIRED)\s*\|/gm,
    )].map((match) => ({ id: match[1], disposition: match[2], frontend: match[3] }));
    const optimizationIds = optimizationRows.map((row) => row.id);
    const optimizationDupes = duplicateIds(optimizationIds);
    if (optimizationRows.length === 0) errors.push("BACKEND_FN_OPTIMIZATION.md: optimization disposition rows=0");
    if (optimizationDupes.length) errors.push(`BACKEND_FN_OPTIMIZATION.md: duplicate optimization IDs: ${optimizationDupes.join(", ")}`);
  }

  for (const phrase of [
    "authentication/account/security principal = Auth User",
    "default X-scoped domain principal = Active X",
    "acting/content/interaction identity = Active X",
    "X-scoped permission resolution = Active X first",
    "must not silently lend its X-scoped permission",
    "## Confirmed TARGET identity decisions",
    "| bookmark/save identity | **Active X** |",
    "No identity decision in this table remains pending for MIG-0011.",
    "CURRENT_DIVERGENCE",
    "video_interactions_auth",
    "production mutation: none",
    "Runtime code change: 0",
    "Cloudflare production resource mutation: 0",
  ]) {
    if (!backendFnOptimization.includes(phrase)) {
      errors.push(`BACKEND_FN_OPTIMIZATION.md: required backend audit marker missing: ${phrase}`);
    }
  }

  // Frontend observable UX ledgers. UX and FN are intentionally many-to-many.
  const validUxStates = new Set([
    "CURRENT_VERIFIED",
    "CURRENT_DIVERGENCE",
    "REQUIREMENT_ONLY",
    "OBSOLETE",
    "MERGED_INTO_OTHER",
  ]);
  const uxRows = [];

  for (const ledgerPath of uxLedgers) {
    const text = read(ledgerPath);
    for (const line of text.split("\n")) {
      const id = line.match(/^\|\s*(UX-[A-Z]+-\d{3})\s*\|/)?.[1];
      if (!id) continue;

      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const state = cells.at(-1);
      const surface = (cells[2] ?? "").replaceAll("`", "").trim();
      uxRows.push({ id, state, surface, ledgerPath, line });
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
  const uxSet = new Set(uxIds);

  // Human-readable full feature catalog must remain an exact derived view of
  // the canonical UX/FN ledgers. This lets every migration agent inspect all
  // existing product capabilities from one Japanese document without making
  // that document a second source of truth.
  const catalogUxIds = [...featureCatalog.matchAll(/^\|\s*(UX-[A-Z]+-\d{3})\s*\|/gm)].map((m) => m[1]);
  const catalogFnIds = [...featureCatalog.matchAll(/^\|\s*(FN-[A-Z]+-\d{3})\s*\|/gm)].map((m) => m[1]);
  const catalogUxSet = new Set(catalogUxIds);
  const catalogFnSet = new Set(catalogFnIds);
  const catalogUxDupes = duplicateIds(catalogUxIds);
  const catalogFnDupes = duplicateIds(catalogFnIds);
  if (catalogUxDupes.length) errors.push(`FEATURE_CATALOG.md: duplicate UX IDs: ${catalogUxDupes.join(", ")}`);
  if (catalogFnDupes.length) errors.push(`FEATURE_CATALOG.md: duplicate FN IDs: ${catalogFnDupes.join(", ")}`);
  if (catalogUxIds.length !== uxRows.length) errors.push(`FEATURE_CATALOG.md: UX rows=${catalogUxIds.length}, expected=${uxRows.length}`);
  if (catalogFnIds.length !== functionRows.length) errors.push(`FEATURE_CATALOG.md: FN rows=${catalogFnIds.length}, expected=${functionRows.length}`);
  for (const id of uxIds) if (!catalogUxSet.has(id)) errors.push(`FEATURE_CATALOG.md: missing UX ${id}`);
  for (const id of functionIds) if (!catalogFnSet.has(id)) errors.push(`FEATURE_CATALOG.md: missing FN ${id}`);
  for (const id of catalogUxIds) if (!uxSet.has(id)) errors.push(`FEATURE_CATALOG.md: unknown UX ${id}`);
  for (const id of catalogFnIds) if (!functionSet.has(id)) errors.push(`FEATURE_CATALOG.md: unknown FN ${id}`);

  for (const marker of [
    "like / bookmark / save はActive X所有",
    "Performance/architecture最適化のために、frontend product behavior変更を必須とするblocker: 0",
    "docs/design-redesign/",
  ]) {
    if (!featureCatalog.includes(marker)) errors.push(`FEATURE_CATALOG.md: required marker missing: ${marker}`);
  }

  for (const adapter of [
    "docs/migration/AGENT_PROTOCOL.md",
    ".claude/commands/flamenode-migration.md",
    ".claude/skills/flamenode-migration/SKILL.md",
    ".codex/skills/flamenode-migration/SKILL.md",
    ".agents/workflows/flamenode-migration.md",
    ".agents/skills/flamenode-migration/SKILL.md",
    ".agents/rules/flamenode-project.md",
  ]) {
    if (!read(adapter).includes("FEATURE_CATALOG.md")) errors.push(`${adapter}: FEATURE_CATALOG.md reference missing`);
  }

  const declaredUxTotal = Number(frontend.match(/\*\*Total baseline\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/i)?.[1]);
  if (!Number.isFinite(declaredUxTotal)) errors.push("FRONTEND_FEATURES.md: Total baseline count is missing");
  else if (declaredUxTotal !== uxRows.length) errors.push(`FRONTEND_FEATURES.md: declared total=${declaredUxTotal}, UX ledger rows=${uxRows.length}`);
  const statusUxTotal = Number(status.match(/Frontend `UX-\*` capabilities\s*\|\s*(\d+)\s*\|/m)?.[1]);
  if (Number.isFinite(statusUxTotal) && statusUxTotal !== uxRows.length) {
    errors.push(`STATUS.md: frontend UX baseline=${statusUxTotal}, ledger rows=${uxRows.length}`);
  }
  const uxStateCounts = uxRows.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});
  for (const state of validUxStates) {
    const reported = Number(frontend.match(new RegExp("\\| `" + state + "` \\| (\\d+) \\|"))?.[1]);
    const actual = uxStateCounts[state] ?? 0;
    if (!Number.isFinite(reported)) errors.push(`FRONTEND_FEATURES.md: ${state} final count is missing`);
    else if (reported !== actual) errors.push(`FRONTEND_FEATURES.md: ${state} reported=${reported}, actual=${actual}`);
  }
  for (const forbiddenState of ["CURRENT_OBSERVED", "AUDIT_REQUIRED"]) {
    if (uxRows.some((row) => row.state === forbiddenState)) {
      errors.push(`frontend UX ledgers: ${forbiddenState} must be 0 after MIG-0011 frontend reconciliation`);
    }
  }


  // MIG-0011 frontend route classification / UX / shell mapping completeness.
  const appPageFiles = walkFiles(file("app"), (p) => p.endsWith(path.sep + "page.tsx"));
  function pageFileRoute(abs) {
    const rel = path.relative(file("app"), abs).split(path.sep).join("/");
    const segments = rel.split("/").slice(0, -1).filter((segment) => !/^\(.+\)$/.test(segment));
    return "/" + segments.join("/");
  }
  const discoveredPages = appPageFiles.map((abs) => ({
    filePath: path.relative(root, abs).split(path.sep).join("/"),
    route: pageFileRoute(abs),
  }));
  const discoveredRouteSet = new Set(discoveredPages.map((row) => row.route));
  const discoveredRouteDupes = duplicateIds(discoveredPages.map((row) => row.route));
  if (discoveredRouteDupes.length) errors.push(`app/**/page.tsx: duplicate logical routes: ${discoveredRouteDupes.join(", ")}`);

  const currentRouteRows = [];
  for (const line of currentRoutes.split("\n")) {
    const match = line.match(/^\|\s*`(\/[^\`]*)`\s*\|\s*`(app\/[^\`]+page\.tsx)`\s*\|\s*(VISUAL_SCREEN|COMPAT_REDIRECT|DEV_ONLY|SYSTEM_SURFACE)\s*\|/);
    if (match) currentRouteRows.push({ route: match[1], filePath: match[2], classification: match[3] });
  }
  const currentRouteSet = new Set(currentRouteRows.map((row) => row.route));
  const currentRouteDupes = duplicateIds(currentRouteRows.map((row) => row.route));
  if (currentRouteDupes.length) errors.push(`CURRENT_ROUTES.md: duplicate classified route rows: ${currentRouteDupes.join(", ")}`);
  if (currentRouteRows.length !== discoveredPages.length) {
    errors.push(`CURRENT_ROUTES.md: classified rows=${currentRouteRows.length}, app page routes=${discoveredPages.length}`);
  }
  const currentByFile = new Map(currentRouteRows.map((row) => [row.filePath, row]));
  for (const page of discoveredPages) {
    const documented = currentByFile.get(page.filePath);
    if (!documented) {
      errors.push(`CURRENT_ROUTES.md: page file unclassified: ${page.filePath}`);
      continue;
    }
    if (documented.route !== page.route) {
      errors.push(`CURRENT_ROUTES.md: ${page.filePath} route=${documented.route}, source-derived=${page.route}`);
    }
  }
  for (const row of currentRouteRows) {
    if (!discoveredRouteSet.has(row.route)) errors.push(`CURRENT_ROUTES.md: classified non-source route: ${row.route}`);
  }

  const routesByClass = new Map(
    ["VISUAL_SCREEN", "COMPAT_REDIRECT", "DEV_ONLY", "SYSTEM_SURFACE"].map((name) => [
      name,
      new Set(currentRouteRows.filter((row) => row.classification === name).map((row) => row.route)),
    ]),
  );
  for (const [name, routes] of routesByClass) {
    if (routes.size === 0) errors.push(`CURRENT_ROUTES.md: route class ${name} is empty`);
  }
  const allClassifiedRoutes = [...routesByClass.values()].flatMap((set) => [...set]);
  if (new Set(allClassifiedRoutes).size !== allClassifiedRoutes.length) {
    errors.push("CURRENT_ROUTES.md: route appears in more than one classification");
  }

  const visualSectionStart = screenMapping.indexOf("## CURRENT VISUAL_SCREEN mapping");
  const compatSectionStart = screenMapping.indexOf("## COMPAT_REDIRECT mapping");
  const devSectionStart = screenMapping.indexOf("## DEV_ONLY page mapping");
  const systemSectionStart = screenMapping.indexOf("## SYSTEM_SURFACE page mapping");
  const shellSectionStart = screenMapping.indexOf("## Cross-route shell mapping");
  const surfaceSectionStart = screenMapping.indexOf("## UX Surface resolution ledger");
  const technicalSectionStart = screenMapping.indexOf("## Technical compatibility routes");
  if ([visualSectionStart, compatSectionStart, devSectionStart, systemSectionStart, shellSectionStart, surfaceSectionStart, technicalSectionStart].some((value) => value < 0)) {
    errors.push("screen-mapping/README.md: required route-class mapping sections are missing");
  } else {
    const parseProfileRows = (section) => {
      const parsed = [];
      for (const line of section.split("\n")) {
        if (!/^\|\s*(Public|Personal|Entry|Manage|Admin|System|Dev)\s*\|/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
        parsed.push({
          group: cells[0],
          route: (cells[1] ?? "").replaceAll("`", ""),
          ux: cells[2] ?? "",
          fn: cells[3] ?? "",
          permission: cells[4] ?? "",
          dynamicState: cells[5] ?? "",
          query: cells[6] ?? "",
          responsive: cells[7] ?? "",
          target: cells[8] ?? "",
          state: cells[9] ?? "",
        });
      }
      return parsed;
    };
    const visualRows = parseProfileRows(screenMapping.slice(visualSectionStart, compatSectionStart));
    const devRows = parseProfileRows(screenMapping.slice(devSectionStart, systemSectionStart));
    const systemRows = parseProfileRows(screenMapping.slice(systemSectionStart, shellSectionStart));
    const visualMappedSet = new Set(visualRows.map((row) => row.route));
    const devMappedSet = new Set(devRows.map((row) => row.route));
    const systemMappedSet = new Set(systemRows.map((row) => row.route));
    for (const [classification, mapped] of [
      ["VISUAL_SCREEN", visualMappedSet],
      ["DEV_ONLY", devMappedSet],
      ["SYSTEM_SURFACE", systemMappedSet],
    ]) {
      const expected = routesByClass.get(classification);
      for (const route of expected) if (!mapped.has(route)) errors.push(`screen-mapping/README.md: ${classification} route missing: ${route}`);
      for (const route of mapped) if (!expected.has(route)) errors.push(`screen-mapping/README.md: ${classification} has non-classified route: ${route}`);
    }
    for (const row of [...visualRows, ...systemRows]) {
      if (!row.ux.includes("UX-")) errors.push(`screen-mapping/README.md: ${row.route} has no route-local UX mapping`);
      if (!row.fn.includes("FN-")) errors.push(`screen-mapping/README.md: ${row.route} has no route-local FN mapping`);
      if (!row.permission.startsWith("P-")) errors.push(`screen-mapping/README.md: ${row.route} permission profile missing`);
      if (!row.dynamicState.startsWith("S-")) errors.push(`screen-mapping/README.md: ${row.route} dynamic-state profile missing`);
      if (!row.query.startsWith("Q-")) errors.push(`screen-mapping/README.md: ${row.route} query/history profile missing`);
      if (!row.responsive.includes("RA-")) errors.push(`screen-mapping/README.md: ${row.route} responsive/a11y profile missing`);
      if (!row.target) errors.push(`screen-mapping/README.md: ${row.route} target route/render disposition missing`);
    }
    for (const row of devRows) {
      if (!row.permission.startsWith("P-") || !row.dynamicState.startsWith("S-") || !row.query.startsWith("Q-") || !row.responsive.includes("RA-")) {
        errors.push(`screen-mapping/README.md: DEV_ONLY ${row.route} profile incomplete`);
      }
    }

    const compatSection = screenMapping.slice(compatSectionStart, devSectionStart);
    const compatRows = [];
    for (const line of compatSection.split("\n")) {
      if (!/^\|\s*`\//.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      compatRows.push({
        source: (cells[0] ?? "").replaceAll("`", ""),
        destination: cells[1] ?? "",
        ux: cells[2] ?? "",
        contract: cells[3] ?? "",
        state: cells[4] ?? "",
      });
    }
    const compatMappedSet = new Set(compatRows.map((row) => row.source));
    for (const route of routesByClass.get("COMPAT_REDIRECT")) {
      if (!compatMappedSet.has(route)) errors.push(`screen-mapping/README.md: COMPAT_REDIRECT route missing: ${route}`);
    }
    for (const row of compatRows) {
      if (!routesByClass.get("COMPAT_REDIRECT").has(row.source)) errors.push(`screen-mapping/README.md: non-COMPAT redirect row: ${row.source}`);
      if (!row.destination || /unknown|tbd/i.test(row.destination)) errors.push(`screen-mapping/README.md: redirect destination unresolved: ${row.source}`);
      if (!row.ux.includes("UX-")) errors.push(`screen-mapping/README.md: redirect UX owner missing: ${row.source}`);
      if (!row.contract) errors.push(`screen-mapping/README.md: redirect query/hash/role contract missing: ${row.source}`);
      if (row.state !== "COMPAT_MAPPED") errors.push(`screen-mapping/README.md: redirect state must be COMPAT_MAPPED: ${row.source}`);
      const destinationRoutes = [...row.destination.matchAll(/\/[A-Za-z0-9_~.\-\[\]]+(?:\/[A-Za-z0-9_~.\-\[\]]+)*/g)]
        .map((match) => match[0].split(/[?#]/, 1)[0]);
      if (!destinationRoutes.length) errors.push(`screen-mapping/README.md: redirect destination is not route-like: ${row.source}`);
      for (const destination of new Set(destinationRoutes)) {
        if (!currentRouteSet.has(destination)) errors.push(`screen-mapping/README.md: redirect destination unknown: ${row.source} -> ${destination}`);
      }
    }

    const visualByRoute = new Map(visualRows.map((row) => [row.route, row]));
    const currentByRoute = new Map(currentRouteRows.map((row) => [row.route, row]));
    for (const row of visualRows) {
      const current = currentByRoute.get(row.route);
      if (!current) continue;
      const pageSource = read(current.filePath);
      if (pageSource.includes("searchParams") && row.query === "Q-DIRECT") {
        errors.push(`screen-mapping/README.md: ${row.route} reads searchParams but is marked Q-DIRECT`);
      }
    }
    for (const [route, expectedPrefix] of [
      ["/list", "Q-LIST("],
      ["/user", "Q-USER("],
      ["/event", "Q-EVENT("],
      ["/user/[id]", "Q-USER-PAGED("],
      ["/rules", "Q-RULES("],
    ]) {
      if (!visualByRoute.get(route)?.query.startsWith(expectedPrefix)) {
        errors.push(`screen-mapping/README.md: ${route} must preserve ${expectedPrefix} contract`);
      }
    }

    const shellSection = screenMapping.slice(shellSectionStart, surfaceSectionStart);
    const shellRows = [];
    for (const line of shellSection.split("\n")) {
      const match = line.match(/^\|\s*`(shell:[A-Z_]+)`\s*\|/);
      if (!match) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      shellRows.push({
        id: match[1],
        ux: cells[2] ?? "",
        fn: cells[3] ?? "",
        responsive: cells[4] ?? "",
        state: cells[5] ?? "",
      });
    }
    const shellSet = new Set(shellRows.map((row) => row.id));
    for (const row of shellRows) {
      if (!row.ux.includes("UX-")) errors.push(`screen-mapping/README.md: ${row.id} has no UX mapping`);
      if (!row.responsive.includes("RA-")) errors.push(`screen-mapping/README.md: ${row.id} has no responsive/a11y profile`);
      if (row.state !== "CURRENT_MAPPED") errors.push(`screen-mapping/README.md: ${row.id} state must be CURRENT_MAPPED`);
    }

    const surfaceSection = screenMapping.slice(surfaceSectionStart, technicalSectionStart);
    const surfaceRows = new Map();
    for (const line of surfaceSection.split("\n")) {
      const match = line.match(/^\|\s*`([^\`]+)`\s*\|\s*(.+?)\s*\|\s*(UX-[^|]+)\|\s*$/);
      if (!match) continue;
      const token = match[1].replaceAll("\\|", "|").trim();
      surfaceRows.set(token, { owners: match[2], ux: match[3] });
    }
    const uxSurfaceSet = new Set(uxRows.map((row) => row.surface));
    if (surfaceRows.size !== uxSurfaceSet.size) {
      errors.push(`screen-mapping/README.md: Surface resolution rows=${surfaceRows.size}, expected=${uxSurfaceSet.size}`);
    }
    for (const surface of uxSurfaceSet) {
      const resolution = surfaceRows.get(surface);
      if (!resolution) {
        errors.push(`screen-mapping/README.md: UX Surface token unresolved: ${surface}`);
        continue;
      }
      const owners = [...resolution.owners.matchAll(/`([^\`]+)`/g)].map((m) => m[1]);
      if (!owners.length) errors.push(`screen-mapping/README.md: Surface token has no owner: ${surface}`);
      for (const owner of owners) {
        if (owner.startsWith("shell:")) {
          if (!shellSet.has(owner)) errors.push(`screen-mapping/README.md: Surface ${surface} references unknown shell ${owner}`);
        } else if (!currentRouteSet.has(owner)) {
          errors.push(`screen-mapping/README.md: Surface ${surface} references unknown route ${owner}`);
        }
      }
    }

    for (const phrase of [
      "CURRENT VISUAL_SCREEN =",
      "COMPAT_REDIRECT =",
      "DEV_ONLY =",
      "SYSTEM_SURFACE =",
      "AUDIT_REQUIRED = 0",
      "CURRENT_OBSERVED = 0",
      "UX Surface tokens with no route/shell resolution = 0",
      "Q-LIST(q,event,sort,page,view)",
      "Q-USER-PAGED(worksPage,collabPage)",
      "RA-BASE",
      "P-MANAGE",
      "P-ADMIN",
      "Frontend unresolved/orphan/unknown owners: **0**",
      "Production mutation: none",
    ]) {
      if (!screenMapping.includes(phrase)) errors.push(`screen-mapping/README.md: required mapping invariant missing: ${phrase}`);
    }
  }

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
    const moduleDirective = /^\s*["']use server["'];/.test(sourceText);
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
  // MIG-0005 Cloudflare CURRENT topology completeness.
  const workerConfigPaths = [
    "wrangler.toml",
    "workers/fast-jobs/wrangler.toml",
    "workers/content-jobs/wrangler.toml",
    "workers/sync-jobs/wrangler.toml",
  ];
  const expectedWorkers = new Set([
    "flamenode-web",
    "flamenode-fast-jobs",
    "flamenode-content-jobs",
    "flamenode-sync-jobs",
  ]);
  const configuredWorkers = workerConfigPaths.map((relative) => {
    const configured = read(relative).match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (!configured) errors.push(`${relative}: Worker name is missing`);
    return configured;
  }).filter(Boolean);
  if (configuredWorkers.length !== 4) errors.push(`Cloudflare Worker configs: actual=${configuredWorkers.length}, expected=4`);
  for (const name of configuredWorkers) {
    if (!expectedWorkers.has(name)) errors.push(`Cloudflare Worker configs: unexpected Worker ${name}`);
    if (!cloudflareTopology.includes(`\`${name}\``)) errors.push(`cloudflare/TOPOLOGY.md: configured Worker missing: ${name}`);
  }
  for (const name of expectedWorkers) {
    if (!configuredWorkers.includes(name)) errors.push(`Cloudflare Worker configs: expected Worker missing: ${name}`);
  }

  for (const phrase of [
    "CURRENT Worker scripts: 4",
    "Custom Domains: 2",
    "Worker Routes: 0",
    "Workers Builds triggers: 1",
    "Independent job-worker build triggers: 0",
    "`flamenode.net`",
    "`www.flamenode.net`",
    "`flamenode_db`",
    "`flamenode-storage`",
    "`flamenode-notification-wake`",
    "`flamenode-notification-dlq`",
    "`flamenode-static-rebuild-wake`",
    "`flamenode-static-rebuild-dlq`",
    "`flamenode-youtube-sync-wake`",
    "`flamenode-youtube-sync-dlq`",
    "Optimization blockers requiring frontend change: 0",
  ]) {
    if (!cloudflareTopology.includes(phrase)) errors.push(`cloudflare/TOPOLOGY.md: required CURRENT topology marker missing: ${phrase}`);
  }

  // MIG-0006 measured Cloudflare performance baseline.
  for (const phrase of [
    "Status: CURRENT_MEASURED",
    "Primary window:",
    "abr_level=10",
    "sampleInterval ~= 10",
    "`exceededCpu`",
    "`exceededMemory`",
    "simple reads: p95 < 5ms",
    "normal mutations: p95 < 8ms",
    "auth-heavy: p95 < 9ms",
    "p50 < 1.5ms",
    "p95 < 3ms",
    "p99 < 5ms",
    "Request-time application CPU target is effectively zero",
    "Production mutation: none",
  ]) {
    if (!performanceBaseline.includes(phrase)) errors.push(`cloudflare/PERFORMANCE_BASELINE.md: required measured baseline marker missing: ${phrase}`);
  }
  for (const role of ["web / fetch", "content / queue", "sync / scheduled", "fast / scheduled"]) {
    if (!performanceBaseline.includes(role)) errors.push(`cloudflare/PERFORMANCE_BASELINE.md: Worker/event baseline missing: ${role}`);
  }

  // MIG-0007 static artifact / visibility baseline.
  const staticRebuildTypesSource = read("src/lib/staticRebuild/types.ts");
  const staticRebuildTypeBlock =
    staticRebuildTypesSource.match(/STATIC_REBUILD_TARGET_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? "";
  const configuredStaticTargets = [...staticRebuildTypeBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  if (configuredStaticTargets.length !== 25) {
    errors.push(`static rebuild target types: actual=${configuredStaticTargets.length}, expected=25`);
  }
  for (const target of configuredStaticTargets) {
    if (!staticDeliveryBaseline.includes(`\`${target}\``)) {
      errors.push(`static-delivery/README.md: target missing from CURRENT ledger: ${target}`);
    }
  }
  for (const phrase of [
    "Status: CURRENT_VERIFIED",
    "CURRENT targetは **25**",
    "`visibility/blocked-entities.v1.json`",
    "`blocked`",
    "`release_pending`",
    "`released`",
    "`enforce`",
    "canonicalTargetId",
    "`static_json_only`",
    "`maintenance`",
    "`degraded_d1`",
    "`requireVisibilityManifestForStale`",
    "`putVisibilityManifestWithCas`",
    "`repairDanglingPublicVisibilityManifestEntry`",
    "Optimization blockers requiring frontend change: **0**",
    "Production mutation: none",
  ]) {
    if (!staticDeliveryBaseline.includes(phrase)) {
      errors.push(`static-delivery/README.md: required CURRENT invariant missing: ${phrase}`);
    }
  }
  for (const id of [
    "FN-PLAT-002",
    "FN-PLAT-003",
    "FN-PLAT-004",
    "FN-PLAT-005",
    "FN-PLAT-006",
    "FN-PLAT-007",
    "FN-PLAT-008",
    "FN-X-004",
    "FN-X-010",
  ]) {
    const row = functionRows.find((candidate) => candidate.id === id);
    if (!["CURRENT_VERIFIED", "PARITY_VERIFIED"].includes(row?.state)) {
      errors.push(`MIG-0007: ${id} must be CURRENT_VERIFIED after static-delivery audit`);
    }
  }

  // MIG-0008 auth / session / identity / permission baseline.
  for (const phrase of [
    "Status: CURRENT_VERIFIED",
    "session strategy: **database**",
    "`allowDangerousEmailAccountLinking`",
    "`access_token`",
    "`refresh_token`",
    "`id_token`",
    "`CurrentUserUnavailableError",
    "`auth_temporarily_unavailable`",
    "database_unavailable",
    "`onboarding_completed_at`",
    "`setActiveXId`",
    "`x_user_account_links`",
    "`event.public_api`",
    "`video.permissions`",
    "all approved linked X IDs",
    "Optimization blockers requiring frontend change: **0**",
    "Production mutation: none",
  ]) {
    if (!authBaseline.includes(phrase)) {
      errors.push(`auth/README.md: required CURRENT invariant missing: ${phrase}`);
    }
  }
  for (const id of [
    "FN-AUTH-001",
    "FN-AUTH-002",
    "FN-AUTH-003",
    "FN-AUTH-004",
    "FN-AUTH-005",
    "FN-AUTH-006",
    "FN-AUTH-007",
    "FN-AUTH-008",
    "FN-AUTH-009",
    "FN-AUTH-010",
    "FN-X-001",
    "FN-X-002",
  ]) {
    const row = functionRows.find((candidate) => candidate.id === id);
    if (!["CURRENT_VERIFIED", "PARITY_VERIFIED"].includes(row?.state)) {
      errors.push(`MIG-0008: ${id} must be CURRENT_VERIFIED after auth/permission audit`);
    }
  }

  for (const phrase of [
    "## TARGET identity priority",
    "Auth User = authentication/account/security principal",
    "Active X = default X-scoped domain principal",
    "like / bookmark / save はすべてActive X所有",
    "X-scoped permission = Active X first",
    "inactive Xの権限をActive Xへ暗黙に貸さない",
  ]) {
    if (!inventory.includes(phrase)) {
      errors.push(`FUNCTION_INVENTORY.md: TARGET identity marker missing: ${phrase}`);
    }
  }

  // MIG-0009 Queue / Cron / background jobs baseline.
  const wakeBudgetSource = read("src/lib/queues/wakeBudget.ts");
  const wakeKindBlock =
    wakeBudgetSource.match(/QUEUE_WAKE_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? "";
  const wakeKinds = [...wakeKindBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  if (wakeKinds.length !== 4) errors.push(`Queue wake kinds: actual=${wakeKinds.length}, expected=4`);
  for (const kind of wakeKinds) {
    if (!backgroundJobsBaseline.includes(`\`${kind}\``)) {
      errors.push(`background-jobs/README.md: Queue wake kind missing: ${kind}`);
    }
  }

  for (const queueName of [
    "flamenode-notification-wake",
    "flamenode-notification-dlq",
    "flamenode-static-rebuild-wake",
    "flamenode-static-rebuild-dlq",
    "flamenode-youtube-sync-wake",
    "flamenode-youtube-sync-dlq",
  ]) {
    if (!wakeBudgetSource.includes(`"${queueName}"`)) {
      errors.push(`wakeBudget.ts: CURRENT Queue name missing: ${queueName}`);
    }
    if (!backgroundJobsBaseline.includes(`\`${queueName}\``)) {
      errors.push(`background-jobs/README.md: CURRENT Queue name missing: ${queueName}`);
    }
  }

  for (const phrase of [
    "Status: CURRENT_VERIFIED",
    "D1 が業務処理の正本",
    "doorbell",
    "Cloudflare DLQとD1",
    "`QUEUE_WAKE_MESSAGE_VERSION = 1`",
    "`0 * * * *`",
    "`15 * * * *`",
    "`7 * * * *`",
    "`52 * * * *`",
    "Application retry budget: **4 attempts**",
    "`delivery_succeeded_awaiting_sent_mark`",
    "`rebuild_succeeded_awaiting_done_mark`",
    "`youtube_sync_pending`",
    "`youtube_playlist_sync`",
    "Platform DLQ has no direct consumer",
    "Optimization blockers requiring frontend change: **0**",
    "Production mutation: none",
  ]) {
    if (!backgroundJobsBaseline.includes(phrase)) {
      errors.push(`background-jobs/README.md: required CURRENT invariant missing: ${phrase}`);
    }
  }

  for (const id of [
    "FN-JOB-001",
    "FN-JOB-002",
    "FN-JOB-003",
    "FN-JOB-004",
    "FN-JOB-005",
    "FN-JOB-006",
    "FN-JOB-007",
    "FN-JOB-008",
    "FN-X-006",
    "FN-PLAT-010",
  ]) {
    const row = functionRows.find((candidate) => candidate.id === id);
    if (!["CURRENT_VERIFIED", "PARITY_VERIFIED"].includes(row?.state)) {
      errors.push(`MIG-0009: ${id} must be CURRENT_VERIFIED after background-job audit`);
    }
  }

  // Design source transition + MIG-0011 Active X requirement gate.
  const pendingHtml = uiReference.includes("`PENDING_HTML`");
  if (!pendingHtml && !/APPROVED_HTML|REGISTERED_HTML|APPROVED/i.test(uiReference)) errors.push("UI_REFERENCE.md: visual reference has neither pending nor approved state");
  if (!uiReference.includes("ユーザーが後日提供するHTML mock")) errors.push("UI_REFERENCE.md: later user-provided HTML mock contract is missing");
  for (const phrase of [
    "authentication principal = Auth User",
    "acting/content/interaction identity = Active X",
    "video_interactions_auth.auth_user_id",
    "CURRENT_DIVERGENCE",
    "TARGET layout/component hierarchyの捏造",
  ]) {
    if (!frontendRequirements.includes(phrase)) errors.push(`FRONTEND_REQUIREMENTS.md: required frontend reconciliation marker missing: ${phrase}`);
  }
  for (const phrase of [
    "authentication principal = Auth User",
    "acting/content/interaction identity = Active X",
    "CURRENT_DIVERGENCE",
  ]) {
    if (!requirements.includes(phrase)) errors.push(`PRODUCT_REQUIREMENTS.md: Active X target marker missing: ${phrase}`);
  }
  const uxById = new Map(uxRows.map((row) => [row.id, row]));
  for (const id of ["UX-VID-025", "UX-VID-026", "UX-VID-027", "UX-LIB-001", "UX-LIB-002", "UX-LIB-008"]) {
    if (!["CURRENT_DIVERGENCE", "MIGRATION_IN_PROGRESS", "BRIDGED", "PARITY_VERIFIED"].includes(uxById.get(id)?.state)) {
      errors.push(`frontend UX ledgers: Active X migration state missing or invalid for ${id}`);
    }
  }
  if (pendingHtml) {
    for (const forbiddenClaim of [
      /^TARGET layout:\s*.+$/m,
      /^TARGET component hierarchy:\s*.+$/m,
      /^Visual target implemented:\s*(yes|done)$/im,
    ]) {
      if (forbiddenClaim.test(frontendRequirements)) {
        errors.push("FRONTEND_REQUIREMENTS.md: target visual was specified while UI_REFERENCE is PENDING_HTML");
      }
    }
  }

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
  if (!/432\s+UX capability/.test(routeMatrix)) errors.push("ROUTE_MATRIX.md: 432 UX mapping contract is missing");
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
    "docs/migration/cloudflare/TOPOLOGY.md",
    "docs/migration/cloudflare/PERFORMANCE_BASELINE.md",
    "docs/migration/static-delivery/README.md",
    "docs/migration/auth/README.md",
    "docs/migration/background-jobs/README.md",
    "docs/migration/screen-mapping/README.md",
  ]) {
    if (!docMap.includes("`" + canonical + "`")) errors.push(`DOC_MAP.md: canonical source missing: ${canonical}`);
  }

  // Shared protocol must force Git, requirements, quality and visual-source rules.
  for (const canonical of ["GIT_WORKFLOW.md", "PRODUCT_REQUIREMENTS.md", "CODE_QUALITY.md", "CURRENT_ROUTES.md", "UI_REFERENCE.md", "server-actions/README.md", "route-handlers/README.md", "cloudflare/TOPOLOGY.md", "cloudflare/PERFORMANCE_BASELINE.md", "static-delivery/README.md", "auth/README.md", "background-jobs/README.md", "screen-mapping/README.md"]) {
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
  for (const phrase of ["GIT_WORKFLOW.md", "PRODUCT_REQUIREMENTS.md", "CODE_QUALITY.md", "UI_REFERENCE.md", "server-actions/README.md", "route-handlers/README.md", "cloudflare/TOPOLOGY.md", "cloudflare/PERFORMANCE_BASELINE.md", "static-delivery/README.md", "auth/README.md", "background-jobs/README.md", "screen-mapping/README.md"]) {
    if (!antigravityRule.includes(phrase)) errors.push(`Antigravity rule: required source missing: ${phrase}`);
  }

  // Execution gates must be enforced against actual STATUS/Decisions/config, not only keyword presence.
  errors.push(...validateMigrationExecution({
    statusText: status,
    decisionsText: read("docs/migration/OPEN_DECISIONS.md"),
    routingText: read("docs/migration/ROUTING_AND_DEPLOY_PLAN.md"),
    viteText: read("apps/app/vite.config.ts"),
    apiSpecText: read("docs/migration/PHASE_6_SPEC.md"),
  }));

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

console.log("[check:migration-docs] OK: classified page routes, final UX dispositions, FN/API/action inventories, route/shell/query/Active-X/UI-reference gates and existing platform baselines are consistent.");
