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

export function validateTaskCards({status, fileContents, runbook, protocol, decisions, smokeDocs}) {
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
  if (!runbook?.includes("1 wake = 1 task")) errors.push("runbook: one-wake-one-task execution contract missing");
  if (!protocol?.includes("IMPLEMENTATION_RUNBOOK.md")) errors.push("AGENT_PROTOCOL: implementation runbook not in mandatory read order");
  if (!protocol?.includes("TASK_CARDS_")) errors.push("AGENT_PROTOCOL: task cards not referenced");
  if(!decisions?.includes("MIG-0308") || !tasks.has("MIG-0308")) errors.push("D-01 packages/db migration task missing");
  if (!runbook?.includes("BLOCKED_ON_USER") || !decisions?.includes("D-08")) errors.push("HTML mock safety gate missing");
  for (const required of ["Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6", "Phase 7", "Phase 8", "Phase 9"]) {
    const text = Object.values(fileContents).join("\n");
    if (!text.includes(required)) errors.push("missing coverage for " + required);
  }
  if (!smokeDocs?.includes("EXACT FILES")) errors.push("small-agent smoke plan is missing");
  return errors;
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
  });
  for(const error of errors)console.error("[migration-task-cards] "+error);
  if(errors.length)process.exitCode=1;
  else console.log("[migration-task-cards] OK: "+TASK_CARD_FILES.length+" card files cover all "+parseTrackedMigrationTasks(read("docs/migration/STATUS.md")).size+" active/future MIG tasks.");
}
