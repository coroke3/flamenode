import test from "node:test";
import assert from "node:assert/strict";
import {validateWorkItems,gitCommitExists,fetchMissingSourceHistory,validateWithHistory} from "./check-migration-work-items.mjs";
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
test("directory ownership conflicts with nested file locks in either order",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const directory of ["src/**","src/","./src/**","src/./**","src\\**"]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+directory);
  const entries={"MIG-0301.md":first,"MIG-0302.md":another};
  assert.match(validateWorkItems({statusText:status,entries}).join("\n"),/already claimed/,directory);
  assert.match(validateWorkItems({statusText:status,entries:{"MIG-0302.md":another,"MIG-0301.md":first}}).join("\n"),/already claimed/,directory);
 }
});

test("equivalent spellings cannot bypass the work-item path lock",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const alias of ["./src/a.ts","src\\a.ts","src/x/../a.ts","src//a.ts"]) {
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+alias);
  assert.match(validateWorkItems({statusText:status,entries:{"MIG-0301.md":active,"MIG-0302.md":second}}).join("\n"),/already claimed/,alias);
 }
});

test("sibling paths and similarly prefixed filenames remain independent",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const other of ["src/a.tsx","src/ab.ts","src2/a.ts","tests/a.ts"]) {
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+other);
  assert.deepEqual(validateWorkItems({statusText:status,entries:{"MIG-0301.md":active,"MIG-0302.md":second}}),[],other);
 }
});

test("root, traversal and absolute path claims fail closed without rejecting legacy globs",()=>{
 for(const bad of ["./**","../src/a.ts","src/../../secret.ts","/src/a.ts","C:\\src\\a.ts","..","src/../**"]) {
  const entry=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+bad);
  const errors=validateWorkItems({statusText:status,entries:{"MIG-0301.md":entry}});
  assert.match(errors.join("\n"),/invalid owned path/,bad);
 }
});

test("trailing slash on recursive ownership cannot bypass a file lock",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for (const glob of ["src/**","src/**/","src/**//","./src/**/","src\\**\\"]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+glob);
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: src/a.ts");
  const entries={"MIG-0301.md":first,"MIG-0302.md":second};
  assert.match(validateWorkItems({statusText:status,entries}).join("\n"),/already claimed/,glob);
  assert.match(validateWorkItems({statusText:status,entries:{"MIG-0302.md":second,"MIG-0301.md":first}}).join("\n"),/already claimed/,glob);
 }
});

test("filename and intermediate glob claims overlap their concrete files",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const [glob,file] of [
  ["src/event*.ts","src/eventCreate.ts"],
  ["src/*.ts","src/a.ts"],
  ["src/**/foo.ts","src/a/foo.ts"],
  ["src/**/foo.ts","src/foo.ts"],
  ["src/**/*.test.mjs","src/unit/a.test.mjs"],
  ["src/event*.ts","src/eventCreate*.ts"]
 ]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+glob);
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+file);
  const entries={"MIG-0301.md":first,"MIG-0302.md":second};
  assert.match(validateWorkItems({statusText:status,entries}).join("\n"),/already claimed/,glob+" vs "+file);
  assert.match(validateWorkItems({statusText:status,entries:{"MIG-0302.md":second,"MIG-0301.md":first}}).join("\n"),/already claimed/,glob+" vs "+file);
 }
});

test("multiple zero-depth recursive segments cannot evade an ownership lock",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const file of ["src/nested/file.ts","src/a/nested/file.ts","src/nested/b/file.ts","src/a/nested/b/file.ts"]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: src/**/nested/**/file.ts");
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+file);
  const entries={"MIG-0301.md":first,"MIG-0302.md":second};
  assert.match(validateWorkItems({statusText:status,entries}).join("\\n"),/already claimed/,file);
  assert.match(validateWorkItems({statusText:status,entries:{"MIG-0302.md":second,"MIG-0301.md":first}}).join("\\n"),/already claimed/,file);
 }
});

test("arbitrary suffix notes cannot bypass concrete or glob ownership",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const [firstPath,secondPath] of [
  ["src/a.ts (ignore collision)","src/a.ts"],
  ["src/a.ts (owner A)","src/a.ts (owner B)"],
  ["src/** (unverified subset)","src/a.ts"],
  ["src/a.ts","src/** (says it is safe)"],
  ["src/a.ts (ignore collision)","src/*.ts"]
 ]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+firstPath);
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+secondPath);
  for(const entries of [
   {"MIG-0301.md":first,"MIG-0302.md":second},
   {"MIG-0302.md":second,"MIG-0301.md":first}
  ]) assert.match(validateWorkItems({statusText:status,entries}).join("\\n"),/already claimed/,firstPath+" vs "+secondPath);
 }
});

test("disjoint globs, sibling paths and annotated ownership scopes stay independent",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 for(const [firstPath,secondPath] of [
  ["src/event*.ts","src/video*.ts"],
  ["src/*.ts","src/a.tsx"],
  ["src/events*.test.mjs","src/videos*.test.mjs"],
  ["src/**/foo.ts","test/a/foo.ts"],
  ["apps/api/src/app.ts (MIG-0604 mount lines only)","apps/api/src/app.ts (MIG-0605 mount lines only)"],
  ["apps/api/test/** (MIG-0605 files)","apps/api/test/events*.test.mjs"]
 ]) {
  const first=active.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+firstPath);
  const second=another.replace("Owned paths: src/a.ts; src/b.ts","Owned paths: "+secondPath);
  assert.deepEqual(validateWorkItems({statusText:status,entries:{"MIG-0301.md":first,"MIG-0302.md":second}}),[],firstPath+" vs "+secondPath);
 }
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

test("rewritten PR tip still verifies the exact old source SHA, never the replacement tip",()=>{
 const prefix=path.join(os.tmpdir(),"flamenode-workitem-rewritten-");
 const temp=fs.mkdtempSync(prefix),builder=path.join(temp,"builder"),remote=path.join(temp,"remote.git"),clone=path.join(temp,"clone");
 const git=(cwd,...args)=>execFileSync("git",["-c","commit.gpgsign=false","-c","core.hooksPath="+path.join(temp,"no-hooks"),...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 try {
  fs.mkdirSync(builder);
  git(builder,"init","-b","main"); git(builder,"config","user.name","Fixture"); git(builder,"config","user.email","fixture@example.invalid");
  fs.writeFileSync(path.join(builder,"source.txt"),"base");git(builder,"add","source.txt");git(builder,"commit","-m","base");
  git(builder,"checkout","-b","task-original"); fs.appendFileSync(path.join(builder,"source.txt"),"\\nfirst source");
  git(builder,"add","source.txt");git(builder,"commit","-m","original task checkpoint");const original=git(builder,"rev-parse","HEAD");
  git(builder,"checkout","main");fs.writeFileSync(path.join(builder,"source.txt"),"rewritten implementation");
  git(builder,"add","source.txt");git(builder,"commit","-m","new unrelated PR tip");const newTip=git(builder,"rev-parse","HEAD");
  git(builder,"update-ref","refs/pull/123/head",newTip);
  git(temp,"init","--bare",remote);git(builder,"remote","add","origin",remote);
  git(builder,"push","origin","main","task-original","refs/pull/123/head");
  git(temp,"clone","--no-local","--single-branch","--branch","main",remote,clone);
  assert.equal(gitCommitExists(clone,original),false,"source is absent even with a valid current PR tip");
  const entries={"MIG-0301.md":active.replace("a".repeat(40),original)};
  assert.deepEqual(fetchMissingSourceHistory(clone,entries),["123"]);
  assert.equal(gitCommitExists(clone,original),true,"exact source object fetched from origin by SHA");
  assert.notEqual(original,newTip,"must never substitute the updated PR head");
  assert.deepEqual(validateWorkItems({statusText:status,entries,commitExists:value=>gitCommitExists(clone,value)}),[]);
 }finally {fs.rmSync(temp,{recursive:true,force:true});}
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


test("unavailable recorded source SHA remains rejected after PR history fetch", () => {
 const prefix=path.join(os.tmpdir(),"flamenode-workitem-unavailable-");
 const temp=fs.mkdtempSync(prefix),builder=path.join(temp,"builder"),remote=path.join(temp,"remote.git"),clone=path.join(temp,"clone");
 const git=(cwd,...args)=>execFileSync("git",["-c","commit.gpgsign=false","-c","core.hooksPath="+path.join(temp,"no-hooks"),...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 try {
  fs.mkdirSync(builder);
  git(builder,"init","-b","main");
  git(builder,"config","user.name","Fixture");
  git(builder,"config","user.email","fixture@example.invalid");
  fs.writeFileSync(path.join(builder,"base.txt"),"base");
  git(builder,"add","base.txt");git(builder,"commit","-m","only valid source");
  git(builder,"update-ref","refs/pull/123/head",git(builder,"rev-parse","HEAD"));
  git(temp,"init","--bare",remote);
  git(builder,"remote","add","origin",remote);
  git(builder,"push","origin","main","refs/pull/123/head");
  git(temp,"clone","--no-local","--single-branch","--branch","main",remote,clone);
  const absent="f".repeat(40);
  const entries={"MIG-0301.md":active.replace("a".repeat(40),absent)};
  assert.equal(gitCommitExists(clone,absent),false);
  // The PR ref fetch succeeds, but the exact recorded SHA is not reachable.
  // Fallback fetch may fail; the final checker must never accept another tip.
  assert.deepEqual(fetchMissingSourceHistory(clone,entries),["123"]);
  assert.equal(gitCommitExists(clone,absent),false);
  assert.match(
   validateWorkItems({statusText:status,entries,commitExists:value=>gitCommitExists(clone,value)}).join("\n"),
   /source SHA is not an available Git commit/,
  );
 }finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test("structural ownership conflict does not suppress requested SHA fetch or permit a false pass",()=>{
 const another=active.replaceAll("MIG-0301","MIG-0302").replaceAll("mig-0301","mig-0302").replace("PR: #123","PR: #124");
 const entries={"MIG-0301.md":active,"MIG-0302.md":another};
 let available=false,fetchCount=0;
 const errors=validateWithHistory({
  statusText:status,entries,
  commitExists:()=>available,
  fetchHistory:()=>{fetchCount++;available=true;},
 });
 assert.equal(fetchCount,1,"fetch must run even when ownership is already invalid");
 assert.match(errors.join("\n"),/already claimed/,"real ownership conflict must remain blocking");
 assert.doesNotMatch(errors.join("\n"),/source SHA is not an available Git commit/,"fetched SHAs must be verified after retrieval");
 const offline=validateWithHistory({statusText:status,entries,commitExists:()=>false});
 assert.match(offline.join("\n"),/already claimed/);
 assert.match(offline.join("\n"),/source SHA is not an available Git commit/,"offline missing-source checks stay strict");
});

test("failed history retrieval never masks structural errors or nonexistent commits",()=>{
 const errors=validateWithHistory({
  statusText:status,entries:{"MIG-0301.md":active},
  commitExists:()=>false,
  fetchHistory:()=>{throw new Error("no origin");},
 });
 assert.match(errors.join("\n"),/could not fetch required PR history/);
 assert.match(errors.join("\n"),/source SHA is not an available Git commit/);
});
