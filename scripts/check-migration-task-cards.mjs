#!/usr/bin/env node
// Validate migration work orders independent of model/agent implementation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_CARD_FILES = Object.freeze([
  "docs/migration/TASK_CARDS_2_3.md",
  "docs/migration/TASK_CARDS_4_5.md",
  "docs/migration/TASK_CARDS_6_7.md",
  "docs/migration/TASK_CARDS_8_9.md",
]);
export const REQUIRED_CARD_FIELDS = Object.freeze(["読む:", "変更", "試験:", "DONE:"]);

export function parseTrackedMigrationTasks(status) {
  const tasks = new Map();
  for (const line of status.split("\n")) {
    const cells = line.split("|").map((s) => s.trim());
    if (/^MIG-0[2-9]\d\d$/.test(cells[1] ?? "")) {
      if (tasks.has(cells[1])) throw new Error("Duplicate MIG in STATUS: " + cells[1]);
      tasks.set(cells[1], {state:cells[3], dependency:cells[4]});
    }
  }
  return tasks;
}

export function collectTaskCards(fileContents) {
  const cards = new Map();
  const errors = [];
  for (const [path, content] of Object.entries(fileContents)) {
    const matches = [...content.matchAll(/^###\s+(MIG-0[2-9]\d\d)\b[^\n]*$/gm)];
    if (!matches.length) errors.push(path + ": no MIG cards");
    for (let i = 0; i < matches.length; i++) {
      const [heading, id] = matches[i];
      const text = content.slice(matches[i].index + heading.length, matches[i + 1]?.index ?? content.length);
      if (cards.has(id)) errors.push(id + ": duplicate card in " + path + " and " + cards.get(id).path);
      else cards.set(id,{path,heading,text});
      for(const marker of REQUIRED_CARD_FIELDS) {
        if(!text.includes(marker)) errors.push(id + ": missing card field " + marker);
      }
    }
  }
  return {cards,errors};
}

export function validateTaskCards({status, fileContents, runbook, protocol, decisions, smokeDocs, microUnits}) {
  const errors = [];
  const tasks = parseTrackedMigrationTasks(status);
  const {cards,errors:cardErrors} = collectTaskCards(fileContents);
  errors.push(...cardErrors);
  for (const [id] of tasks) {
    if (!cards.has(id)) errors.push(id + ": STATUS task without executable work card");
  }
  for (const [id] of cards) {
    if(!tasks.has(id)) errors.push(id + ": card has no STATUS task (register dependency and status first)");
  }
  if (!/1 wake = 1 (?:task|action)\b/.test(runbook || "")) errors.push("runbook: one-wake-one-action execution contract missing");
  if (!protocol?.includes("IMPLEMENTATION_RUNBOOK.md")) errors.push("AGENT_PROTOCOL: IMPLEMENTATION_RUNBOOK.md not in mandatory read order");
  if (!protocol?.includes("TASK_CARDS_")) errors.push("AGENT_PROTOCOL: task cards not referenced");
  if(!decisions?.includes("MIG-0308") || !tasks.has("MIG-0308")) errors.push("D-01 packages/db migration task missing");
  const mockGatePassed = (runbook?.includes("BLOCKED_ON_USER") || (runbook?.includes("DECIDED") && runbook?.includes("UI_REFERENCE"))) && decisions?.includes("D-08");
  if (!mockGatePassed) errors.push("HTML mock safety gate missing");
  for (const required of ["Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6", "Phase 7", "Phase 8", "Phase 9"]) {
    const text = Object.values(fileContents).join("\n");
    if (!text.includes(required)) errors.push("missing coverage for " + required);
  }
  if (!smokeDocs?.includes("EXACT FILES")) errors.push("small-agent smoke plan is missing");
  if (microUnits !== undefined) {
    for (const id of ["MIG-0304","MIG-0305","MIG-0306","MIG-0502","MIG-0504","MIG-0507","MIG-0604","MIG-0605","MIG-0704","MIG-0705"]) {
      if (!microUnits.includes("## " + id) || !microUnits.includes("**U01")) errors.push(id + ": large task has no resumable micro-unit work order");
    }
    if (!protocol?.includes("TASK_MICRO_UNITS.md") || !runbook?.includes("TASK_MICRO_UNITS.md")) errors.push("micro-unit resumable instructions not in runbook and protocol");
  }
  return errors;
}

// Work Orders: the `### MIG-XXXX:` section of the phase spec is the executable recipe for small models.
export const SPEC_FILES = Object.freeze({
  "01": "docs/migration/PHASE_1_SPEC.md",
  "02": "docs/migration/PHASE_2_SPEC.md",
  "03": "docs/migration/PHASE_3_SPEC.md",
  "04": "docs/migration/PHASE_4_5_SPEC.md",
  "05": "docs/migration/PHASE_4_5_SPEC.md",
  "06": "docs/migration/PHASE_6_SPEC.md",
  "07": "docs/migration/PHASE_7_SPEC.md",
  "08": "docs/migration/PHASE_8_9_SPEC.md",
  "09": "docs/migration/PHASE_8_9_SPEC.md",
});
export const WORK_ORDER_SECTIONS = Object.freeze(["Source snapshot", "Owned paths", "Micro-units", "Test cases", "Commands", "Ledger updates", "DONE checklist", "STOP", "Rollback"]);
export const specFileFor = (id) => SPEC_FILES[id.slice(4, 6)] ?? null;

// Only prose can declare readiness. Examples inside backtick/tilde fences are never policy.
function proseLines(text) {
  let fence = null;
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return " ".repeat(line.length);
    }
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      return " ".repeat(line.length);
    }
    return line;
  });
}

// Only prose can declare readiness. Examples inside backtick/tilde fences are never policy.
function proseLines(text) {
  let fence = null;
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return " ".repeat(line.length);
    }
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      return " ".repeat(line.length);
    }
    return line;
  });
}

// Section runs from its `### MIG-XXXX` heading to the next h1–h3 heading outside fenced code.
function workOrderSections(specText) {
  const lines = specText.replace(/\r\n/g, "\n").split("\n");
  const prose = proseLines(specText);
  const sections = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const heading = /^#{1,3}\s/.test(prose[index]);
    if (heading) {
      if (current) sections.push(current);
      const id = line.match(/^###\s+(MIG-\d{4})\b/)?.[1];
      current = id ? { id, lines: [line] } : null;
    } else if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections.map(({ id, lines: body }) => ({ id, text: body.join("\n").trim() }));
}

export function parseWorkOrder(text) {
  text = text.replace(/\r\n/g, "\n");
  const prose = proseLines(text).join("\n");
  const values = (field) => [...prose.matchAll(new RegExp("^(?:- )?\\*\\*" + field + ":\\*\\*[^\\S\\n]*([^\\n]+)$", "gm"))].map((match) => match[1].trim());
  const models = values("Model"), readiness = values("Readiness");
  return {
    text,
    prose,
    model: models.length === 1 && /^(small|lead)$/.test(models[0]) ? models[0] : null,
    readiness: readiness.length === 1 ? readiness[0].match(/^(READY_FOR_SMALL_MODEL|NEEDS_REFINEMENT)(?:\s+—\s+.+)?$/)?.[1] ?? null : null,
    declaresModel: models.length > 0,
    declaresReadiness: readiness.length > 0,
    metadataDuplicates: models.length > 1 || readiness.length > 1,
  };
}

export function extractWorkOrder(specText, id) {
  const sections = workOrderSections(specText ?? "").filter((s) => s.id === id);
  return sections.length === 1 ? parseWorkOrder(sections[0].text) : null;
}

export function validateWorkOrder(id, order) {
  if (!order) return [id + ": missing or duplicate work order"];
  const errors = [];
  if (order.metadataDuplicates) errors.push(id + ": duplicate Model/Readiness metadata");
  if (!order.model) errors.push(id + ": Model must be small or lead");
  if (!order.readiness) errors.push(id + ": Readiness must be READY_FOR_SMALL_MODEL or NEEDS_REFINEMENT");
  if (order.readiness === "READY_FOR_SMALL_MODEL") {
    if (order.model !== "small") errors.push(id + ": READY_FOR_SMALL_MODEL requires Model: small");
    if (!/^(?:- )?\*\*Verified against:\*\*[^\S\n]*`[0-9a-f]{7,40}`(?:\s|$)/m.test(order.prose)) errors.push(id + ": small-model work order needs Verified against `<sha>`");
    for (const section of WORK_ORDER_SECTIONS) {
      const heading = new RegExp("^####\\s+" + section + "\\s*$", "gm");
      const matches = [...order.prose.matchAll(heading)];
      if (matches.length !== 1) {
        errors.push(id + ": small-model work order " + (matches.length ? "duplicate" : "missing") + " #### " + section);
        continue;
      }
      // Use the original text here: a section containing a command fence has real content.
      const start = matches[0].index + matches[0][0].length;
      const next = order.prose.slice(start).search(/^####\s/m);
      const content = order.text.slice(start, next < 0 ? undefined : start + next).trim();
      if (!content || /^(?:[-*]\s*)?(?:TBD|TODO|pending|未定|後で)$/i.test(content)) errors.push(id + ": empty #### " + section);
    }
    if (!/^[-*] \*\*U01\b/m.test(order.prose)) errors.push(id + ": small-model work order has no U01 micro-unit");
    errors.push(...validateSmallModelOrder(id, order.text));
  }
  return errors;
}

export function validateWorkOrders({ status, specs }) {
  const errors = [];
  const tasks = parseTrackedMigrationTasks(status);
  for (const [file, text] of Object.entries(specs)) {
    if (text === undefined) continue;
    const seen = new Set();
    for (const { id } of workOrderSections(text)) {
      if (seen.has(id)) errors.push(file + ": duplicate work order heading " + id);
      seen.add(id);
    }
  }
  for (const [id, task] of tasks) {
    const file = specFileFor(id);
    const order = file ? extractWorkOrder(specs[file], id) : null;
    if (!order) {
      if (task.state === "READY") errors.push(id + ": READY task has no work order section in " + file);
      continue;
    }
    if (task.state === "READY" && (!order.model || !order.readiness)) errors.push(id + ": READY task work order must declare Model and Readiness");
    if (task.state === "READY" || order.declaresModel || order.declaresReadiness) errors.push(...validateWorkOrder(id, order));
  }
  return errors;
}


// A small model executes the order literally, so everything it needs must be decided in the text.
const VAGUE_PHRASES = ["適宜", "必要に応じて", "可能なら", "TBD", "検討する", "うまく"];


export function validateSmallModelOrder(id, text) {
  const errors = [];
  const units = sectionBodies(text, "Micro-units").join("\n");
  if (!/```bash/.test(units)) errors.push(id + ": small-model Micro-units need a ```bash command block");
  if (!/期待/.test(units)) errors.push(id + ": small-model Micro-units need an expected result (期待)");
  for (const phrase of VAGUE_PHRASES) {
    if (text.includes(phrase)) errors.push(id + ": small-model work order contains undecided wording: " + phrase);
  }
  for (const line of sectionBodies(text, "Owned paths").join("\n").split("\n")) {
    if (/^- (新規|変更|削除)/.test(line) && line.includes("*")) errors.push(id + ": small-model Owned paths must list exact files, not globs: " + line.trim());
  }
  return errors;
}

export const RUNTIME_CLASSES = Object.freeze(["S0", "S1", "S2", "S3", "S4", "B", "N"]);

export function parseRecipeIds(recipesText) {
  return new Set([...(recipesText ?? "").matchAll(/^## (R-[A-Z]+):/gm)].map((m) => m[1]));
}

// Plan completeness: every unfinished tracked task has a full work order whose
// dependencies agree with the merged STATUS graph, and READY really means unblocked.
function expandMigRefs(text) {
  const ids = new Set();
  for (const m of (text ?? "").matchAll(/MIG-(\d{4})(?:\.\.MIG-(\d{4}))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to; n++) ids.add("MIG-" + String(n).padStart(4, "0"));
  }
  return ids;
}

function parseAllMigrationStates(status) {
  const states = new Map();
  for (const line of status.split("\n")) {
    const cells = line.split("|").map((s) => s.trim());
    if (/^MIG-\d{4}$/.test(cells[1] ?? "")) states.set(cells[1], cells[3]);
  }
  return states;
}

export function validatePlanCompleteness({ status, specs, recipes }) {
  const recipeIds = recipes === undefined ? null : parseRecipeIds(recipes);
  const errors = [];
  const tasks = parseTrackedMigrationTasks(status);
  const states = parseAllMigrationStates(status);
  const deps = new Map([...tasks].map(([id, t]) => [id, expandMigRefs(t.dependency)]));
  const closure = (id, seen = new Set()) => {
    for (const dep of deps.get(id) ?? []) {
      if (!seen.has(dep)) { seen.add(dep); closure(dep, seen); }
    }
    return seen;
  };
  for (const [id, task] of tasks) {
    if (task.state === "READY") {
      for (const dep of deps.get(id)) {
        if (states.get(dep) !== "DONE") errors.push(id + ": READY but dependency " + dep + " is " + (states.get(dep) ?? "unknown"));
      }
    }
    if (task.state === "DONE" || task.state === "SKIPPED") continue;
    const file = specFileFor(id);
    const order = file ? extractWorkOrder(specs[file], id) : null;
    if (!order) { errors.push(id + ": unfinished task has no work order in " + file); continue; }
    if (!order.model || !order.readiness) errors.push(id + ": work order must declare valid Model and Readiness");
    if (!/\*\*Verified against:\*\*\s*`[0-9a-f]{7,40}`/.test(order.prose)) errors.push(id + ": work order needs Verified against `<sha>`");
    for (const section of WORK_ORDER_SECTIONS) {
      const count = sectionBodies(order.text, section).length;
      if (count !== 1) errors.push(id + ": work order " + (count ? "duplicate" : "missing") + " #### " + section);
    }
    const recipeLine = order.prose.match(/\*\*Recipe:\*\*([^\n]*)/)?.[1];
    if (recipeLine === undefined) errors.push(id + ": work order missing Recipe (IMPLEMENTATION_RECIPES.md)");
    else if (recipeIds) {
      const named = recipeLine.match(/R-[A-Z]+/g) ?? [];
      if (!named.length) errors.push(id + ": Recipe names no R-* section");
      for (const r of named) if (!recipeIds.has(r)) errors.push(id + ": Recipe " + r + " is not a section of IMPLEMENTATION_RECIPES.md");
    }
    const runtimeLine = order.prose.match(/\*\*Runtime:\*\*([^\n]*)/)?.[1];
    if (runtimeLine === undefined) errors.push(id + ": work order missing Runtime (ZERO_1102.md)");
    else {
      const classes = runtimeLine.split(/[,、\s]+/).filter(Boolean);
      if (!classes.length || classes.some((c) => !RUNTIME_CLASSES.includes(c))) errors.push(id + ": Runtime must list ZERO_1102.md classes " + RUNTIME_CLASSES.join("/") + ", got: " + runtimeLine.trim());
    }
    const dependsLine = order.prose.match(/\*\*Depends on:\*\*([^\n]*)/)?.[1];
    if (dependsLine === undefined) { errors.push(id + ": work order missing Depends on"); continue; }
    const declared = expandMigRefs(dependsLine.split("**Decisions:**")[0]);
    for (const dep of deps.get(id)) {
      if (!declared.has(dep)) errors.push(id + ": work order Depends on omits STATUS dependency " + dep);
    }
    const reachable = closure(id);
    for (const dep of declared) {
      if (!deps.get(id).has(dep) && !reachable.has(dep)) errors.push(id + ": work order depends on " + dep + " but STATUS has no such dependency path");
    }
  }
  return errors;
}

export function readSpecs(read) {
  return Object.fromEntries([...new Set(Object.values(SPEC_FILES))].map((p) => {
    try { return [p, read(p)]; } catch (error) { if (error.code === "ENOENT") return [p, undefined]; throw error; }
  }));
}

const invoked = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if(invoked){
  const root=process.cwd();
  const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
  const errors=validateTaskCards({
    status:read("docs/migration/STATUS.md"),
    fileContents:Object.fromEntries(TASK_CARD_FILES.map(p=>[p,read(p)])),
    runbook:read("docs/migration/IMPLEMENTATION_RUNBOOK.md"),
    protocol:read("docs/migration/AGENT_PROTOCOL.md"),
    decisions:read("docs/migration/OPEN_DECISIONS.md"),
    smokeDocs:read("docs/migration/SMALL_MODEL_SMOKE_TEST.md"),
    microUnits:read("docs/migration/TASK_MICRO_UNITS.md"),
  });
  errors.push(...validateWorkOrders({status:read("docs/migration/STATUS.md"),specs:readSpecs(read)}));
  errors.push(...validatePlanCompleteness({status:read("docs/migration/STATUS.md"),specs:readSpecs(read),recipes:read("docs/migration/IMPLEMENTATION_RECIPES.md")}));
  for(const error of errors)console.error("[migration-task-cards] "+error);
  if(errors.length)process.exitCode=1;
  else console.log("[migration-task-cards] OK: "+TASK_CARD_FILES.length+" card files cover all "+parseTrackedMigrationTasks(read("docs/migration/STATUS.md")).size+" active/future MIG tasks.");
}
