#!/usr/bin/env node
// Local checkpoint structure/ownership validation, not a remote PR/CI/review audit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const fields = ["Task","State","Owner","Branch","PR","Head","Owned paths","Current unit","Validation","Evidence","Rollback","Next"];
const activeStates = new Set(["IN_PROGRESS","REVIEW","BLOCKED"]);
const allStates = new Set(["READY","IN_PROGRESS","REVIEW","BLOCKED","DONE"]);
const sha = /^[0-9a-f]{40}$/;

export function readWorkItems(root) {
  const dir=path.join(root,"docs/migration/work-items");
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir).filter(x=>x.endsWith(".md")&&!["README.md","TEMPLATE.md"].includes(x))
    .map(x=>[x,fs.readFileSync(path.join(dir,x),"utf8")]));
}
export function gitCommitExists(root, value) {
  if (!sha.test(value || "")) return false;
  try {
    execFileSync("git", ["cat-file", "-e", value + "^{commit}"], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function validateWorkItems({statusText,entries,commitExists}) {
  const errors=[], ids=new Set([...statusText.matchAll(/^\|\s*(MIG-\d{4})\s*\|/gm)].map(m=>m[1])), claimed=new Map(), prs=new Map(), branches=new Map();
  for(const [filename,body] of Object.entries(entries)) {
    if(!/^MIG-\d{4}\.md$/.test(filename)){errors.push("invalid filename: "+filename);continue;}
    const id=filename.slice(0,-3), map={};
    if(!ids.has(id))errors.push(filename+": task absent from STATUS");
    if(!body.startsWith("# "+id+" "))errors.push(filename+": first heading mismatch");
    for(const f of fields) {
      const matches=[...body.matchAll(new RegExp("^"+f+":\\s*(.*)$","gm"))];
      if(matches.length!==1||!matches[0][1].trim())errors.push(filename+": expected one "+f);
      else map[f]=matches[0][1].trim();
    }
    if(map.Task!==id)errors.push(filename+": Task mismatch");
    if(!allStates.has(map.State))errors.push(filename+": invalid State");
    if(map.State==="READY"&&[map.Owner,map.Branch,map.PR].some(x=>x!=="none"))errors.push(filename+": READY must be unclaimed");
    if(activeStates.has(map.State)||map.State==="DONE") {
      if(!map.Owner||map.Owner==="none")errors.push(filename+": missing real owner");
      if(!new RegExp("^migration/"+id.toLowerCase()+"-[a-z0-9][a-z0-9-]*$").test(map.Branch||""))errors.push(filename+": invalid task branch");
      if(!/^#\d+$/.test(map.PR||""))errors.push(filename+": invalid real PR number");
      if(!sha.test(map.Head||""))errors.push(filename+": missing previous source SHA");
      else if(commitExists && !commitExists(map.Head))errors.push(filename+": source SHA is not an available Git commit (fetch full history): "+map.Head);
      if(!map["Owned paths"]||map["Owned paths"]==="none")errors.push(filename+": missing owned paths");
      if(!map["Current unit"]||map["Current unit"]==="none")errors.push(filename+": missing micro-unit");
      for(const [label,value,seen] of [["PR",map.PR,prs],["Branch",map.Branch,branches]]) {
        if(value&&value!=="none"){if(seen.has(value))errors.push(filename+": "+label+" also claimed by "+seen.get(value));else seen.set(value,filename);}
      }
      if(activeStates.has(map.State))for(const p of (map["Owned paths"]||"").split(";").map(x=>x.trim()).filter(x=>x&&x!=="none")){
        if(claimed.has(p))errors.push(filename+": path "+p+" already claimed by "+claimed.get(p));
        else claimed.set(p,filename);
      }
    }
    if(["REVIEW","DONE"].includes(map.State))for(const f of ["Validation","Evidence"]){
      if(!map[f]||/^(none|not run|pending)/i.test(map[f]))errors.push(filename+": "+f+" required for "+map.State);
    }
    if(map.State==="BLOCKED"&&(!map.Next||map.Next==="none"))errors.push(filename+": missing resume condition");
  }
  return errors;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const statusText=fs.readFileSync(path.join(root,"docs/migration/STATUS.md"),"utf8"),entries=readWorkItems(root);
  const errors=validateWorkItems({statusText,entries,commitExists: value => gitCommitExists(root,value)});
  if(errors.length){errors.forEach(x=>console.error("[migration:work-items] "+x));process.exitCode=1;}
  else{
    console.log("[migration:work-items] OK: "+Object.keys(entries).length+" checkpoints");
    if(process.argv.includes("--status")){
      for(const [filename,body] of Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)))
        console.log(filename.slice(0,-3)+" | "+body.match(/^State:\s*(.*)$/m)?.[1]+" | "+body.match(/^PR:\s*(.*)$/m)?.[1]);
      console.log("Note: remote open PR/CI/review are not checked.");
    }
  }
}
