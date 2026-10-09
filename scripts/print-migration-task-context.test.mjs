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
