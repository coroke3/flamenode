import test from "node:test";
import assert from "node:assert/strict";
import { getTaskContext, getWorkOrder, getNextTaskContext, parseContextArgs } from "./print-migration-task-context.mjs";
import { CRITICAL_PATH } from "./print-migration-task-context.mjs";
import { parseTaskRows, expandDependencies } from "./check-migration-execution.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("MIG-0401 packet shows READY, direct dependency and no unrelated cards",()=>{
 const r=getTaskContext("MIG-0401");
 assert.match(r.output,/MIG-0401 — narrow/);
 assert.match(r.output,/STATUS: (?:READY|DONE)/);
 assert.match(r.output,/MIG-0105:DONE/);
 assert.match(r.output,/public snapshot loader PoC/);
 assert.doesNotMatch(r.output,/### MIG-0405/);
 assert.doesNotMatch(r.output,/^\| D-08 \|/m);
 assert.match(r.output,/D-08 visual HTML remains a gate for later visual work/);
 assert.ok(r.chars<12000,"single PoC context should be compact");
});
test("large Manage/Admin task yields bounded navigation, not complete feature ledgers",()=>{
 const r=getTaskContext("MIG-0705");
 assert.ok(r.fileRows>0,"some admin source rows should exist");
 assert.ok(r.chars<24000,"MIG scope > context budget: choose micro-unit");
 assert.doesNotMatch(r.output,/^# FlameNode Platform Migration/m);
});
test("unknown or malformed task is rejected",()=>{
 assert.throws(()=>getTaskContext("MIG-9999"),/Unknown MIG task/);
 assert.throws(()=>getTaskContext("all tasks"),/exact MIG/);
});

import { pickNextTask } from "./print-migration-task-context.mjs";

test("next-task advisory prioritizes performance without requiring D-08 for nonvisual PoC",()=>{
 const status=[
  "| MIG-0105 | site | DONE | — |",
  "| MIG-0108 | boundary | DONE | — |",
  "| MIG-0301 | domain | READY | MIG-0108 |",
  "| MIG-0401 | perf | READY | MIG-0105 |",
  "| MIG-0402 | visual | BLOCKED | MIG-0401 |",
 ].join("\n");
 const decisions="| D-08 | HTML | BLOCKED_ON_USER | user |";
 const next=pickNextTask(status,decisions);
 assert.equal(next.selected,"MIG-0401");
 assert.deepEqual(next.candidates,["MIG-0401","MIG-0301"]);
});
import { parseOwnedTasks } from "./print-migration-task-context.mjs";

test("next-task advisory skips READY tasks already owned by an open PR",()=>{
 const status=[
  "| MIG-0105 | site | DONE | — |",
  "| MIG-0108 | boundary | DONE | — |",
  "| MIG-0301 | domain | READY | MIG-0108 |",
  "| MIG-0401 | perf | READY | MIG-0105 |",
 ].join("\n");
 const owned=parseOwnedTasks([{number:283,headRefName:"migration/mig-0401-public-snapshot-loader"},{number:290,headRefName:"fix/docs"}]);
 assert.deepEqual([...owned],[["MIG-0401",283]]);
 const next=pickNextTask(status,"",owned);
 assert.equal(next.selected,"MIG-0301");
 assert.deepEqual(next.ownedByPr,["MIG-0401"]);
 assert.equal(pickNextTask(status,"",new Map([["MIG-0401",1],["MIG-0301",2]])).selected,null);
});
test("next-task advisory stops on unmerged dependencies",()=>{
 const status="| MIG-0105 | site | IN_PROGRESS | — |\n| MIG-0401 | perf | READY | MIG-0105 |";
 assert.equal(pickNextTask(status,"").selected,null);
});

test("visual tasks include D-08 and are never labelled nonvisual",()=>{
 for(const id of ["MIG-0201","MIG-0403","MIG-0407","MIG-0501","MIG-0508"]){
  const {output}=getTaskContext(id);
  assert.match(output,/^\| D-08 \|/m,id);
  assert.doesNotMatch(output,/does NOT block this nonvisual task/,id);
 }
});
test("unregistered HTML blocks a READY design task in the advisory selector",()=>{
 const status="| MIG-0200 | register | DONE | — |\n| MIG-0201 | extract | READY | MIG-0200 |";
 assert.equal(pickNextTask(status,"| D-08 | HTML | BLOCKED_ON_USER | user |").selected,null);
 assert.equal(pickNextTask(status,"| D-08 | HTML | DECIDED | user |").selected,"MIG-0201");
});
test("small-model advisory only offers tasks whose work order is READY_FOR_SMALL_MODEL",()=>{
 const status="| MIG-0108 | boundary | DONE | — |\n| MIG-0201 | tokens | READY | MIG-0108 |\n| MIG-0301 | domain | READY | MIG-0108 |";
 const next=pickNextTask(status,"",new Map(),id=>id==="MIG-0301");
 assert.equal(next.selected,"MIG-0301");
 assert.deepEqual(next.candidates,["MIG-0301"]);
 assert.equal(pickNextTask(status,"",new Map(),()=>false).selected,null);
});

test("small-model selection requires the full recipe, not only readiness labels", () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"migration-context-"));
 try {
  fs.mkdirSync(path.join(root,"docs/migration"),{recursive:true});
  const file=path.join(root,"docs/migration/PHASE_3_SPEC.md");
  const labels="### MIG-0301: incomplete\n- **Model:** small\n- **Readiness:** READY_FOR_SMALL_MODEL\n";
  fs.writeFileSync(file,labels);
  assert.equal(getWorkOrder("MIG-0301",root).smallReady,false);
  fs.writeFileSync(file,labels+"\n"+labels);
  assert.equal(getWorkOrder("MIG-0301",root).smallReady,false);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("explicit MIG IDs cannot bypass the small-model restriction", () => {
 assert.throws(()=>getTaskContext("MIG-0401",undefined,{smallOnly:true}),/no complete READY_FOR_SMALL_MODEL/);
});

test("unknown, missing and duplicate CLI model options are rejected", () => {
 assert.deepEqual(parseContextArgs(["--next","--model","small","--offline"]),{task:null,automatic:true,offline:true,openPrBranches:null,smallOnly:true});
 assert.equal(parseContextArgs(["MIG-0301","--model","small"]).smallOnly,true);
 for(const args of [["--next","--model"],["--next","--model","smal"],["--next","--model","small","--model","lead"],["--next","--nonsense"],["--next","MIG-0301"]]){
  assert.throws(()=>parseContextArgs(args),/--model must|Unknown or duplicate/);
 }
});

test("packet carries the recipe shape and the 1102 budget named by the work order",()=>{
 const api=getTaskContext("MIG-0603").output;
 assert.match(api,/## R-API:/);
 assert.match(api,/^\| `S2` \|/m);
 assert.match(api,/^\| `S3` \|/m);
 assert.doesNotMatch(api,/## R-PAGE:/);
 const domain=getTaskContext("MIG-0301").output;
 assert.match(domain,/## R-DOMAIN:/);
 assert.match(domain,/## 全レシピ共通/);
});

test("--next fails closed when open PRs were not read, unless --offline was given", () => {
 assert.throws(()=>getNextTaskContext(undefined,{owned:new Map(),live:false}),/Open PRs could not be read/);
 assert.doesNotThrow(()=>{try{getNextTaskContext(undefined,{owned:new Map(),live:false,offline:true});}catch(error){if(/Open PRs could not be read/.test(error.message))throw error;}});
});

test("CLI exits non-zero for a misspelled model and for an explicit lead task under --model small", () => {
 const script=fileURLToPath(new URL("./print-migration-task-context.mjs",import.meta.url));
 const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:"utf8"});
 for(const args of [["--next","--model","smal","--offline"],["--next","--model"],["MIG-0401","--next"]]){
  const r=run(...args);
  assert.equal(r.status,1,args.join(" "));
  assert.match(r.stderr,/--model must|Unknown or duplicate/);
 }
 const lead=run("MIG-0401","--model","small");
 assert.equal(lead.status,1);
 assert.match(lead.stderr,/MIG-0401: no complete READY_FOR_SMALL_MODEL/);
 assert.equal(lead.stdout,"");
});

test("--open-pr-branches carries MCP-read ownership into the selector", () => {
 const a=parseContextArgs(["--next","--model","small","--open-pr-branches","migration/mig-0201-tokens, fix/docs"]);
 assert.deepEqual(a.openPrBranches,["migration/mig-0201-tokens","fix/docs"]);
 assert.deepEqual(parseContextArgs(["--next","--open-pr-branches",""]).openPrBranches,[]);
 assert.throws(()=>parseContextArgs(["--next","--open-pr-branches"]),/comma-separated/);
 assert.throws(()=>parseContextArgs(["--next","--offline","--open-pr-branches",""]),/exclusive/);
 const owned=parseOwnedTasks(a.openPrBranches.map(headRefName=>({number:"?("+headRefName+")",headRefName})));
 assert.deepEqual([...owned.keys()],["MIG-0201"]);
});

test("a lead takes the 1102 measurement path before other READY work", () => {
 const status=["| MIG-0108 | b | DONE | — |","| MIG-0401 | p | DONE | — |","| MIG-0201 | t | READY | MIG-0108 |","| MIG-0404 | r | READY | MIG-0401 |","| MIG-0801 | a | READY | MIG-0108 |"].join("\n");
 assert.deepEqual(pickNextTask(status,"| D-08 | HTML | DECIDED | user |").candidates,["MIG-0404","MIG-0201","MIG-0801"]);
});

test("CLI drops tasks owned by the branches passed with --open-pr-branches", () => {
 const script=fileURLToPath(new URL("./print-migration-task-context.mjs",import.meta.url));
 const status=fs.readFileSync(fileURLToPath(new URL("../docs/migration/STATUS.md",import.meta.url)),"utf8");
 const ready=[...parseTaskRows(status)].filter(([,t])=>t.state==="READY").map(([id])=>id);
 const free=spawnSync(process.execPath,[script,"--next","--open-pr-branches",""],{encoding:"utf8"});
 if(!ready.length){assert.equal(free.status,1);return;}  // late migration: nothing READY, the selector stops
 assert.equal(free.status,0,free.stderr);
 const first=/advisory candidate=(MIG-\d{4})/.exec(free.stderr)[1];
 const slug="migration/mig-"+first.slice(4)+"-x";
 const owned=spawnSync(process.execPath,[script,"--next","--open-pr-branches",slug],{encoding:"utf8"});
 assert.match(owned.stderr,new RegExp("owned-by-open-PR="+first+"=PR#\\?\\("+slug.replace(/[/]/g,"\\/")+"\\)"));
 assert.doesNotMatch(owned.stderr,new RegExp("advisory candidate="+first+" "));
});

test("CRITICAL_PATH lists Phase 4 Gate prerequisites in an order STATUS allows", () => {
 const status=fs.readFileSync(fileURLToPath(new URL("../docs/migration/STATUS.md",import.meta.url)),"utf8");
 const tasks=parseTaskRows(status);
 const ancestors=id=>{const seen=new Set(),stack=[id];while(stack.length){for(const d of expandDependencies(tasks.get(stack.pop())?.dependencies??""))if(!seen.has(d)){seen.add(d);stack.push(d);}}return seen;};
 const gate=ancestors("MIG-0407");
 CRITICAL_PATH.forEach((id,i)=>{
  assert.ok(tasks.has(id),id+" missing from STATUS");
  assert.ok(gate.has(id),id+" is not a Phase 4 Gate prerequisite");
  for(const later of CRITICAL_PATH.slice(i+1))assert.ok(!ancestors(id).has(later),id+" depends on later "+later);
 });
});
