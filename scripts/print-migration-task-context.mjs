#!/usr/bin/env node
// A compact navigational packet only; never a replacement for CURRENT code, AGENTS or canonical ledgers.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTaskRows, expandDependencies, REQUIRED_DECISIONS } from "./check-migration-execution.mjs";
import { parseFileRows } from "./check-migration-file-progress.mjs";
import { TASK_CARD_FILES, collectTaskCards, specFileFor, extractWorkOrder } from "./check-migration-task-cards.mjs";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=(root,file)=>fs.readFileSync(path.join(root,file),"utf8");
const readOptional=(root,file)=>{try{return read(root,file);}catch{return undefined;}};
export function getWorkOrder(id,root=ROOT){
  const file=specFileFor(id);
  const order=file?extractWorkOrder(readOptional(root,file),id):null;
  return {file,order,smallReady:order?.model==="small"&&order?.readiness==="READY_FOR_SMALL_MODEL"};
}
// Recipe sections and runtime budgets that a work order points to, so the packet carries the code shape and the 1102 budget.
function markdownSection(text,heading){
  const start=text.indexOf("\n"+heading);
  if(start===-1)return null;
  const next=text.indexOf("\n## ",start+1);
  return text.slice(start+1,next===-1?undefined:next).trim();
}
export function getRecipeContext(orderText,root=ROOT){
  if(!orderText)return [];
  const recipes=readOptional(root,"docs/migration/IMPLEMENTATION_RECIPES.md")??"";
  const zero=readOptional(root,"docs/migration/ZERO_1102.md")??"";
  const names=(orderText.match(/\*\*Recipe:\*\*([^\n]*)/)?.[1].match(/R-[A-Z]+/g))??[];
  const runtimes=(orderText.match(/\*\*Runtime:\*\*([^\n]*)/)?.[1].split(/[,、\s]+/).filter(Boolean))??[];
  const sections=["## 全レシピ共通",...names.map(n=>"## "+n+":")].map(h=>markdownSection(recipes,h)).filter(Boolean);
  const budgetRows=zero.split("\n").filter(line=>runtimes.some(r=>line.startsWith("| `"+r+"` |")));
  return [
    "## Recipe (docs/migration/IMPLEMENTATION_RECIPES.md)",
    ...(sections.length?sections:["No Recipe line: NEEDS_REFINEMENT."]),
    "",
    "## Runtime budget (docs/migration/ZERO_1102.md §3; design rules §4)",
    ...(budgetRows.length?["| ID | 種別 | 例 | Worker | CPU 最大値の予算 | 構造上の上限 |","| --- | --- | --- | --- | --- | --- |",...budgetRows]:["No Runtime line: NEEDS_REFINEMENT."]),
    "",
  ];
}
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
  const visualGateIsInformational=["MIG-0401","MIG-0404","MIG-0405","MIG-0406"].includes(id);
  const decisionRows=decisions.split("\n").filter(line=>decisionIds.some(d=>new RegExp("^\\|\\s*"+d+"\\s*\\|").test(line)));
  const {file:specFile,order,smallReady}=getWorkOrder(id,root);
  const dir="docs/migration/";
  const lines=[
    "# "+id+" — narrow source-of-truth navigation packet",
    "> Read root AGENTS.md, the relevant AGENT_PROTOCOL.md and GIT_WORKFLOW.md rules. This output is a **locator**, not permission to omit CURRENT code/test or independent review.",
    "",
    "## STATUS: "+task.state+" — "+task.title,
    "Work order: Model="+(order?.model??"unset")+" Readiness="+(order?.readiness??"unset")+(smallReady?" -> a small model may execute it":" -> lead only (small models must not claim it)"),
    "Dependencies: "+(dependencies.map(d=>d+":"+String(tasks.get(d)?.state??"UNKNOWN")).join("; ")||"none"),
    "Required decisions / approval (inspect full relevant subsection):",
    ...(decisionRows.length?decisionRows:["none explicit for this task; production approvals remain separate"]),
    ...(visualGateIsInformational?["D-08 visual HTML remains a gate for later visual work; it does NOT block this nonvisual task."]:[]),
    "",
    "## Exact task card ("+(card?.path??"no Phase2–9 card")+")",
    card?.heading??"",
    card?.text.trim()??"See STATUS and CURRENT code; no runnable Phase2–9 card recorded for this historical task.",
    "",
    "## Work order ("+(specFile??"no phase spec")+")",
    order?.text??("No '### "+id+":' work order section yet: NEEDS_REFINEMENT. A lead must write it (IMPLEMENTATION_RUNBOOK.md Work Order format) before a small model starts."),
    "",
    ...getRecipeContext(order?.text,root),
    "## Assigned source-file rows ("+owned.length+"; full ledger remains authoritative)",
    ...owned.map(row=>" - "+row.path+" | "+row.kind+" | "+row.state+" | "+row.target),
    "",
    "## Next files to open (filtered by the task)",
    "- "+dir+"STATUS.md: merged task/dependency row; owner/PR is LIVE on GitHub and task work-items/MIG-XXXX.md",
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

// Live ownership hint from open PR branch names (migration/mig-XXXX-*). Never a lock; the PR itself stays authoritative.
export function parseOwnedTasks(prs){
  const owned=new Map();
  for(const pr of prs){
    const match=/^migration\/mig-(\d{4})-/.exec(pr.headRefName||"");
    if(match)owned.set("MIG-"+match[1],pr.number);
  }
  return owned;
}
export function readOpenPrOwners(root=ROOT){
  try{
    const out=execFileSync("gh",["pr","list","--state","open","--limit","100","--json","number,headRefName"],{cwd:root,encoding:"utf8",timeout:15000,stdio:["ignore","pipe","ignore"]});
    return {owned:parseOwnedTasks(JSON.parse(out)),live:true};
  }catch{return {owned:new Map(),live:false};}
}

// Advisory selector: merged STATUS dependency state, minus tasks already owned by an open PR when known.
export function pickNextTask(statusText,decisionText,owned=new Map(),eligible=()=>true){
  const tasks=parseTaskRows(statusText);
  const decisions=new Map();
  for(const line of decisionText.split("\n")){
    const cells=line.split("|").map(x=>x.trim());
    if(/^D-\d{2}$/.test(cells[1]||""))decisions.set(cells[1],cells[3]);
  }
  const candidates=[];
  for(const [id,task] of tasks){
    if(task.state!=="READY")continue;
    const deps=expandDependencies(task.dependencies);
    if(deps.some(d=>tasks.get(d)?.state!=="DONE"))continue;
    if((REQUIRED_DECISIONS[id]||[]).some(d=>decisions.get(d)!=="DECIDED"))continue;
    if(!eligible(id))continue;
    candidates.push(id);
  }
  // Optimize for 1102 first when independent performance PoC is already unblocked.
  candidates.sort((a,b)=>(a==="MIG-0401"?-1:b==="MIG-0401"?1:a.localeCompare(b)));
  const ownedByPr=candidates.filter(id=>owned.has(id));
  return {selected:candidates.find(id=>!owned.has(id))??null,candidates,ownedByPr};
}
export function getNextTaskContext(root=ROOT,owners=readOpenPrOwners(root),{smallOnly=false}={}){
  const eligible=smallOnly?(id=>getWorkOrder(id,root).smallReady):()=>true;
  const next=pickNextTask(read(root,"docs/migration/STATUS.md"),read(root,"docs/migration/OPEN_DECISIONS.md"),owners.owned,eligible);
  const ownedNote=next.ownedByPr.map(id=>id+"=PR#"+owners.owned.get(id)).join(",");
  if(!next.selected){
    if(ownedNote)throw new Error("Every dependency-ready MIG is owned by an open PR ("+ownedNote+"); resume your own PR, review another agent's REVIEW PR, or stop");
    throw new Error(smallOnly?"No dependency-ready MIG with a READY_FOR_SMALL_MODEL work order; a lead must refine one (AGENT_PROTOCOL.md Wake decision 4) or stop":"No dependency-ready MIG in merged STATUS; check blockers, approvals and active owner PRs");
  }
  const result=getTaskContext(next.selected,root);
  return {...result,selected:next.selected,candidates:next.candidates,ownedNote,live:owners.live};
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 try{
  const automatic=process.argv[2]==="--next";
  const owners=process.argv.includes("--offline")?{owned:new Map(),live:false}:undefined;
  const modelAt=process.argv.indexOf("--model");
  const smallOnly=modelAt>0&&process.argv[modelAt+1]==="small";
  const {output,chars,fileRows,selected,candidates,ownedNote,live}=automatic?getNextTaskContext(ROOT,owners,{smallOnly}):getTaskContext(process.argv[2]);
  if(automatic)process.stderr.write("[migration-context] advisory candidate="+selected+" READY candidates="+candidates.join(",")+(ownedNote?" owned-by-open-PR="+ownedNote:"")+(live?"":" (open PRs not checked)")+"; verify live GitHub PRs and decisions before claiming\n");
  process.stdout.write(output);
  process.stderr.write("[migration-context] chars="+chars+" assigned source rows="+fileRows+" (source/test and policy are additional required reads)\n");
  if(chars>24000)process.stderr.write("[migration-context] NOTE: large packet; split by TASK_MICRO_UNITS.md and scoped source rows before passing to a model\n");
 }catch(error){console.error("[migration-context] "+error.message);process.exitCode=1;}
}
