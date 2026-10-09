#!/usr/bin/env node
// A compact navigational packet only; never a replacement for CURRENT code, AGENTS or canonical ledgers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTaskRows, expandDependencies, REQUIRED_DECISIONS } from "./check-migration-execution.mjs";
import { parseFileRows } from "./check-migration-file-progress.mjs";
import { TASK_CARD_FILES, collectTaskCards } from "./check-migration-task-cards.mjs";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=(root,file)=>fs.readFileSync(path.join(root,file),"utf8");
export function getTaskContext(id,root=ROOT){
  if(!/^MIG-\d{4}$/.test(id))throw new Error("Provide one exact MIG-XXXX task ID");
  const status=read(root,"docs/migration/STATUS.md");
  const tasks=parseTaskRows(status),task=tasks.get(id);
  if(!task)throw new Error("Unknown MIG task: "+id);
  const decisions=read(root,"docs/migration/OPEN_DECISIONS.md");
  const {cards}=collectTaskCards(Object.fromEntries(TASK_CARD_FILES.map(p=>[p,read(root,p)])));
  const card=cards.get(id);
  const {rows}=parseFileRows(read(root,"docs/migration/FILE_MIGRATION_MATRIX.md"));
  const owned=[...rows.values()].filter(row=>row.owner===id).sort((a,b)=>a.path.localeCompare(b.path));
  const dependencies=expandDependencies(task.dependencies);
  const decisionIds=[...(REQUIRED_DECISIONS[id]||[])];
  if(/^MIG-0[45]/.test(id)&&!decisionIds.includes("D-08"))decisionIds.push("D-08");
  const decisionRows=decisions.split("\n").filter(line=>decisionIds.some(d=>new RegExp("^\\|\\s*"+d+"\\s*\\|").test(line)));
  const dir="docs/migration/";
  const lines=[
    "# "+id+" — narrow source-of-truth navigation packet",
    "> Read root AGENTS.md, the relevant AGENT_PROTOCOL.md and GIT_WORKFLOW.md rules. This output is a **locator**, not permission to omit CURRENT code/test or independent review.",
    "",
    "## STATUS: "+task.state+" — "+task.title,
    "Dependencies: "+(dependencies.map(d=>d+":"+String(tasks.get(d)?.state??"UNKNOWN")).join("; ")||"none"),
    "Required decisions / approval (inspect full relevant subsection):",
    ...(decisionRows.length?decisionRows:["none explicit; still obey production and D-08 requirements"]),
    "",
    "## Exact task card ("+(card?.path??"no Phase2–9 card")+")",
    card?.heading??"",
    card?.text.trim()??"See STATUS and CURRENT code; no runnable Phase2–9 card recorded for this historical task.",
    "",
    "## Assigned source-file rows ("+owned.length+"; full ledger remains authoritative)",
    ...owned.map(row=>" - "+row.path+" | "+row.kind+" | "+row.state+" | "+row.target),
    "",
    "## Next files to open (filtered by the task)",
    "- "+dir+"STATUS.md: current owner PR/branch, relevant MIG row and dependencies",
    "- "+dir+"OPEN_DECISIONS.md: only cited D-xx sections",
    "- "+dir+"FILE_MIGRATION_MATRIX.md: task-owned rows and impacted consumer rows",
    "- "+dir+"FILE_PROGRESS_PROTOCOL.md: required evidence and file states",
    "- CURRENT source files, importer graph and test files cited by the task card",
    "- "+dir+"DOC_MAP.md: only if an unknown source-of-truth question remains",
    "",
    "STOP: A READY task is not DONE, and a data-only PoC is not approved visual/production cutover.",
  ];
  const output=lines.join("\n")+"\n";
  return {output,chars:output.length,fileRows:owned.length};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 try{
  const {output,chars,fileRows}=getTaskContext(process.argv[2]);
  process.stdout.write(output);
  process.stderr.write("[migration-context] chars="+chars+" assigned source rows="+fileRows+" (source/test and policy are additional required reads)\n");
  if(chars>24000)process.stderr.write("[migration-context] NOTE: large packet; split by TASK_MICRO_UNITS.md and scoped source rows before passing to a model\n");
 }catch(error){console.error("[migration-context] "+error.message);process.exitCode=1;}
}
