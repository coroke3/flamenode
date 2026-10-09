#!/usr/bin/env node
// Check source->target file ownership and contract links for the migration.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_KINDS = new Set(["PAGE","ROUTE_HANDLER","SERVER_ACTION","ACTION_HELPER","DB_SCHEMA","WORKER_ENTRY","TARGET_SKELETON","CONFIG","TEST"]);
const ALLOWED_STATES = new Set(["NOT_STARTED","IN_PROGRESS","BRIDGED","PARITY_VERIFIED","CUTOVER","RETIRED","RETAINED","BLOCKED"]);
const FILE_ROW_RE = /^\|\s*\x60([^\x60]+)\x60\s*\|/;

export function parseFileRows(markdown) {
  const section=markdown.split("## Migration ledger\n")[1]?.split("\n## Future files")[0];
  if (!section) throw new Error("FILE_MIGRATION_MATRIX: missing migration ledger section");
  const rows=new Map(), errors=[];
  for (const line of section.split("\n")) {
    if(!FILE_ROW_RE.test(line))continue;
    const cells=line.split("|").slice(1,-1).map(x=>x.trim());
    if(cells.length!==7){errors.push("file row has "+cells.length+" columns, expected 7: "+line.slice(0,90));continue;}
    const match=cells[0].match(/^\x60([^\x60]+)\x60$/);
    if(!match){errors.push("invalid file path cell: "+cells[0]);continue;}
    const file=match[1];
    if(rows.has(file))errors.push("duplicate file row: "+file);
    else rows.set(file,{path:file,kind:cells[1],linkage:cells[2],owner:cells[3],target:cells[4],state:cells[5],evidence:cells[6]});
  }
  return {rows,errors};
}

export function parsePageLedger(text){
 const out=new Map();
 for(const m of text.matchAll(/^\|\s*\x60([^"\x60]+)\x60\s*\|\s*\x60(app\/[^\x60]+page\.tsx)\x60\s*\|\s*(VISUAL_SCREEN|COMPAT_REDIRECT|DEV_ONLY|SYSTEM_SURFACE)\s*\|/gm)){
  if(out.has(m[2]))throw new Error("duplicate CURRENT_ROUTES file: "+m[2]);
  out.set(m[2],{url:m[1],kind:m[3]});
 }
 return out;
}
export function parseRouteHandlerLedger(text){
 const out=new Map();
 for(const m of text.matchAll(/^\|\s*(RH-\d+)\s*\|\s*([A-Z]+)\s*\|\s*([^|]+?)\s*\|/gm)){
  const key="app"+m[3].trim()+"/route.ts";
  const arr=out.get(key)||[];arr.push(m[1]+":"+m[2]);out.set(key,arr);
 }
 return out;
}
export function parseActionLedger(text){
 const out=new Map();
 for(const m of text.matchAll(/^\|\s*(SA-\d+)\s*\|\s*\x60([^\x60]+)\x60\s*\|/gm)){
  const source=m[2].split("#")[0];const arr=out.get(source)||[];arr.push(m[1]);out.set(source,arr);
 }
 return out;
}
export function parseMigs(text){
 return new Map([...text.matchAll(/^\|\s*(MIG-\d{4})\s*\|\s*[^|]+\|\s*([A-Z_]+)\s*\|/gm)].map(m=>[m[1],m[2]]));
}
export function isTrackedSourceCandidate(p){
 return (/^app\/.*\/page\.tsx$/.test(p) ||
  /^app\/api\/.*\/route\.ts$/.test(p) ||
  /^src\/lib\/actions\/.*\.ts$/.test(p) ||
  /^src\/lib\/db\/schema(?:\.base|\.canonical)?\.ts$/.test(p) ||
  /^workers\/[^/]+\/index\.ts$/.test(p) ||
  /^(?:apps\/(?:api|app|site|ops)|packages\/(?:contracts|domain|ui|db))\/(?:src\/.*\.(?:ts|tsx|astro)|(?:vite\.config\.ts|astro\.config\.mjs|tsconfig\.json|package\.json|index\.html))$/.test(p) ||
  ["wrangler.toml","drizzle.config.ts","tsconfig.base.json","package.json","package-lock.json"].includes(p));
}
function trackedChangeCandidate(p){
 return /^(?:app\/|apps\/|packages\/|src\/lib\/|workers\/)/.test(p) &&
 !/(?:^|\/)(?:node_modules|dist|\.next)\//.test(p) ||
 ["wrangler.toml","drizzle.config.ts","tsconfig.base.json","package.json","package-lock.json"].includes(p);
}
const listChangedFromBase=base=>{
 if(!/^[0-9a-f]{40}$/.test(base))throw new Error("MIGRATION_FILE_BASE_SHA must be 40 hex");
 const raw=execFileSync("git",["diff","--name-only",base+"...HEAD"],{cwd:ROOT,encoding:"utf8"});
 return raw.trim().split("\n").filter(Boolean);
};
export function collectFiles(root=ROOT){
 const files=[];
 function visit(dir){
  if(!fs.existsSync(dir))return;
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   if(["node_modules",".git",".next","dist",".wrangler",".astro","coverage"].includes(item.name))continue;
   const child=path.join(dir,item.name);
   if(item.isDirectory())visit(child);
   else if(item.isFile())files.push(path.relative(root,child).replaceAll(path.sep,"/"));
  }
 }
 for(const sub of ["app","src/lib/actions","src/lib/db","workers","apps","packages"])visit(path.join(root,sub));
 for(const base of ["wrangler.toml","drizzle.config.ts","tsconfig.base.json","package.json","package-lock.json"]){
  if(fs.existsSync(path.join(root,base)))files.push(base);
 }
 return files;
}
export function validateFileProgress({matrix,currentRoutes,routeHandlers,serverActions,status,filePaths,changedPaths=[]}){
 const errors=[];
 const {rows,errors:parseErrors}=parseFileRows(matrix);errors.push(...parseErrors);
 const pages=parsePageLedger(currentRoutes), RH=parseRouteHandlerLedger(routeHandlers),SA=parseActionLedger(serverActions),migs=parseMigs(status);
 const actual=new Set(filePaths);
 const mandatory=new Set(filePaths.filter(isTrackedSourceCandidate));
 for(const file of mandatory)if(!rows.has(file))errors.push("missing file progress row for source: "+file);
 for(const [file,row] of rows){
  if(!ALLOWED_KINDS.has(row.kind))errors.push(file+" invalid file kind "+row.kind);
  if(!ALLOWED_STATES.has(row.state))errors.push(file+" invalid file state "+row.state);
  if(!migs.has(row.owner))errors.push(file+" references missing owner task "+row.owner);
  if(!actual.has(file)&&row.state!=="RETIRED")errors.push(file+" source file absent but state is "+row.state);
  if(row.state!=="NOT_STARTED"){
   if(!/PR#\d+/.test(row.evidence)||!/SHA=[0-9a-f]{40}\b/.test(row.evidence))errors.push(file+" progress evidence requires real PR# and SHA=40hex");
   if(["BRIDGED","PARITY_VERIFIED","CUTOVER","RETIRED","RETAINED"].includes(row.state)&&!/\bTEST=/.test(row.evidence))errors.push(file+" advanced state requires TEST=...");
   if(["CUTOVER","RETIRED"].includes(row.state)&&!/\bAPPROVAL=/.test(row.evidence))errors.push(file+" production/destructive state requires APPROVAL=...");
   if(["BRIDGED","PARITY_VERIFIED","CUTOVER","RETIRED"].includes(row.state)&&(/\bTBD\b|\bcandidate\b/i.test(row.target)||row.target.startsWith("+")))errors.push(file+" advanced state has unverified target path");
  }
  const p=pages.get(file);
  if(row.kind==="PAGE"){
   if(!p)errors.push(file+" PAGE lacks CURRENT_ROUTES row");
   else if(row.linkage!==p.url+" ("+p.kind+")")errors.push(file+" route and class mismatch: "+row.linkage+" != "+p.url+" ("+p.kind+")");
  }else if(p) errors.push(file+" must be PAGE");
  const rh=RH.get(file);
  if(row.kind==="ROUTE_HANDLER"){
   if(!rh)errors.push(file+" Route Handler lacks RH method ledger");
   else if(rh.join(",")!==row.linkage)errors.push(file+" RH linkage mismatch");
  }else if(rh)errors.push(file+" must be ROUTE_HANDLER");
  if(file.startsWith("src/lib/actions/")&&file.endsWith(".ts")){
   const sa=SA.get(file)||[];
   const expected=sa.join(",")||"no SA export; inspect callers";
   if(row.linkage!==expected)errors.push(file+" SA linkage mismatch expected="+expected);
   if(row.kind!==(sa.length?"SERVER_ACTION":"ACTION_HELPER"))errors.push(file+" action kind mismatch");
  }
 }
 for(const [f] of pages)if(!rows.has(f))errors.push(f+" CURRENT_ROUTES row not tracked");
 for(const [f] of RH)if(!rows.has(f))errors.push(f+" RH method source not tracked");
 for(const [f] of SA)if(!rows.has(f))errors.push(f+" SA source not tracked");
 for(const file of changedPaths.filter(trackedChangeCandidate)){
  if(!rows.has(file))errors.push("changed migration source missing file progress row: "+file);
 }
 if(rows.size<mandatory.size)errors.push("file progress rows fewer than required current sources");
 return errors;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
 let changedPaths=[];
 try{if(process.env.MIGRATION_FILE_BASE_SHA)changedPaths=listChangedFromBase(process.env.MIGRATION_FILE_BASE_SHA);}
 catch(e){console.error("[migration-file] git changed-file validation unavailable: "+e.message);process.exit(1);}
 const input={
  matrix:read("docs/migration/FILE_MIGRATION_MATRIX.md"),
  currentRoutes:read("docs/migration/CURRENT_ROUTES.md"),
  routeHandlers:read("docs/migration/route-handlers/README.md"),
  serverActions:read("docs/migration/server-actions/README.md"),
  status:read("docs/migration/STATUS.md"),
  filePaths:collectFiles(),
  changedPaths,
 };
 const errors=validateFileProgress(input);
 for(const e of errors)console.error("[migration-file] "+e);
 if(errors.length)process.exitCode=1;
 else console.log("[migration-file] PASS: "+parseFileRows(input.matrix).rows.size+" source files connected; "+parsePageLedger(input.currentRoutes).size+" pages, "+[...parseRouteHandlerLedger(input.routeHandlers).values()].reduce((n,a)=>n+a.length,0)+" RH methods, "+[...parseActionLedger(input.serverActions).values()].reduce((n,a)=>n+a.length,0)+" SA IDs; changed files="+changedPaths.length);
}