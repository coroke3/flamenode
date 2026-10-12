import test from "node:test";
import assert from "node:assert/strict";
import {validateWorkItems,gitCommitExists,fetchMissingSourceHistory} from "./check-migration-work-items.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";

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

test("formatted but nonexistent source SHA is rejected",()=>{
 const errors=validateWorkItems({statusText:status,entries:{"MIG-0301.md":active},commitExists:()=>false});
 assert.match(errors.join(" "),/source SHA is not an available Git commit/);
});
test("available source commit is accepted without claiming it is the tested head",()=>{
 const errors=validateWorkItems({statusText:status,entries:{"MIG-0301.md":active},commitExists:value=>value==="a".repeat(40)});
 assert.deepEqual(errors,[]);
});

test("fresh squash clone can verify the prior source commit through its preserved PR ref",()=>{
 const prefix=path.join(os.tmpdir(),"flamenode-workitem-");
 const temp=fs.mkdtempSync(prefix),builder=path.join(temp,"builder"),remote=path.join(temp,"remote.git"),clone=path.join(temp,"clone");
 const git=(cwd,...args)=>execFileSync("git",["-c","commit.gpgsign=false","-c","core.hooksPath="+path.join(temp,"no-hooks"),...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 try {
  fs.mkdirSync(builder);
  git(builder,"init","-b","main"); git(builder,"config","user.name","Fixture"); git(builder,"config","user.email","fixture@example.invalid");
  fs.writeFileSync(path.join(builder,"source.txt"),"base"); git(builder,"add","source.txt"); git(builder,"commit","-m","base");
  git(builder,"checkout","-b","task"); fs.appendFileSync(path.join(builder,"source.txt"),"\nimplementation");
  git(builder,"add","source.txt"); git(builder,"commit","-m","task source"); const source=git(builder,"rev-parse","HEAD");
  git(builder,"update-ref","refs/pull/123/head",source); git(builder,"checkout","main");
  git(builder,"merge","--squash","task"); git(builder,"commit","-m","squash task");
  git(temp,"init","--bare",remote); git(builder,"remote","add","origin",remote);
  git(builder,"push","origin","main","refs/pull/123/head");
  git(temp,"clone","--no-local","--single-branch","--branch","main",remote,clone);
  assert.equal(gitCommitExists(clone,source),false,"main full history alone must not contain the pre-squash source");
  const entries={"MIG-0301.md":active.replace("a".repeat(40),source)};
  assert.deepEqual(fetchMissingSourceHistory(clone,entries),["123"]);
  assert.deepEqual(validateWorkItems({statusText:status,entries,commitExists:value=>gitCommitExists(clone,value)}),[]);
  assert.deepEqual(fetchMissingSourceHistory(clone,entries),[],"known source must not fetch again");
 } finally {
  if(path.resolve(temp).startsWith(path.resolve(prefix)))fs.rmSync(temp,{recursive:true,force:true});
 }
});
