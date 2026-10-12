import test from "node:test";
import assert from "node:assert/strict";
import { getTaskContext } from "./print-migration-task-context.mjs";

test("MIG-0401 packet shows READY, direct dependency and no unrelated cards",()=>{
 const r=getTaskContext("MIG-0401");
 assert.match(r.output,/MIG-0401 — narrow/);
 assert.match(r.output,/STATUS: READY/);
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
test("next-task advisory stops on unmerged dependencies",()=>{
 const status="| MIG-0105 | site | IN_PROGRESS | — |\n| MIG-0401 | perf | READY | MIG-0105 |";
 assert.equal(pickNextTask(status,"").selected,null);
});
