import test from "node:test";
import assert from "node:assert/strict";
import {validateWorkItems} from "./check-migration-work-items.mjs";

const status="| MIG-0301 | a | READY | MIG-0108 | x |\n| MIG-0302 | b | READY | MIG-0108 | x |\n";
const ready=[
"# MIG-0301 — task","Task: MIG-0301","State: READY","Owner: none","Branch: none","PR: none","Head: none",
"Owned paths: none","Current unit: none","Validation: not run","Evidence: none","Rollback: no change","Next: check main",
"","## Scope","Only one task"
].join("\n");
const active=ready.replace("State: READY","State: IN_PROGRESS").replace("Owner: none","Owner: claude")
 .replace("Branch: none","Branch: migration/mig-0301-domain")
 .replace("PR: none","PR: #123").replace("Head: none","Head: "+"a".repeat(40))
 .replace("Owned paths: none","Owned paths: src/a.ts; src/b.ts")
 .replace("Current unit: none","Current unit: U01");

test("valid READY",()=>assert.deepEqual(validateWorkItems({statusText:status,entries:{"MIG-0301.md":ready}}),[]));
test("valid bounded IN_PROGRESS",()=>assert.deepEqual(validateWorkItems({statusText:status,entries:{"MIG-0301.md":active}}),[]));
test("READY cannot claim PR",()=>assert.match(validateWorkItems({statusText:status,entries:{"MIG-0301.md":ready.replace("PR: none","PR: #123")}}).join(" " ),/must be unclaimed/));
test("duplicate paths are rejected",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 assert.match(validateWorkItems({statusText:status,entries:{"MIG-0301.md":active,"MIG-0302.md":another}}).join(" "),/already claimed/);
});
test("REVIEW requires evidence",()=>assert.match(validateWorkItems({statusText:status,entries:{"MIG-0301.md":active.replace("State: IN_PROGRESS","State: REVIEW")}}).join(" "),/Evidence required/));
test("unknown MIG rejected",()=>assert.match(validateWorkItems({statusText:status,entries:{"MIG-0999.md":ready}}).join(" "),/absent from STATUS/));
