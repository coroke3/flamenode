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

// Squash merges do not retain every source commit in main's ancestry.
// Network access is explicit; ordinary validation remains local/offline.
export function fetchMissingSourceHistory(root, entries) {
  const fetched = new Set();
  for (const body of Object.values(entries)) {
    const head = body.match(/^Head:\s*([0-9a-f]{40})\s*$/m)?.[1];
    const pr = body.match(/^PR:\s*#(\d+)\s*$/m)?.[1];
    if (!head || !pr || gitCommitExists(root, head) || fetched.has(pr)) continue;
    // A squash-merged PR may have moved/rewritten its refs/pull/N/head after
    // the recorded checkpoint. Fetching its current ref alone then leaves the
    // historic Head SHA unavailable despite GitHub still serving that commit.
    // Fetch the exact, strictly validated 40-hex SHA as a fallback. Never
    // substitute the PR's new tip: validateWorkItems still checks the ORIGINAL
    // recorded commit object with git cat-file -e SHA^{commit}.
    try {
      execFileSync("git", ["fetch", "--no-tags", "origin", "refs/pull/" + pr + "/head"], { cwd: root, stdio: "ignore" });
    } catch {
      // A deleted PR ref is not evidence that the recorded commit is invalid.
      // The exact-SHA attempt and the final commitExists gate decide validity.
    }
    if (!gitCommitExists(root, head)) {
      try {
        execFileSync("git", ["fetch", "--no-tags", "origin", head], { cwd: root, stdio: "ignore" });
      } catch {
        // Fail closed through validateWorkItems: no fabricated or substituted SHA.
      }
    }
    fetched.add(pr);
  }
  return [...fetched];
}

// A task can claim either a file or a directory (including dir/**).
// Normalize path spellings before checking ownership so "./", Windows separators,
// and internal "." / ".." segments cannot bypass another active writer's lock.
function canonicalOwnedPath(value) {
  // Existing checkpoint notes can be scoped (e.g. "app.ts (mount lines only)").
  // Keep those labels intact rather than broadening the ownership claim.
  const posix = value.replaceAll("\\", "/").replace(/\/+$/, "");
  if (path.posix.isAbsolute(posix) || /^[A-Za-z]:/.test(posix)) return null;
  const segments = posix.split("/");
  // Collapsing ".." after a wildcard would change its meaning, not just spelling.
  if (segments.some((part, i) => part === ".." && segments.slice(0, i).some(x => x.includes("*") || x.includes("?"))))
    return null;
  const normalized = path.posix.normalize(posix);
  if (normalized === "." || normalized === ".." || normalized === "**" || normalized.startsWith("../"))
    return null;
  return normalized;
}

// A path claim includes that path and its descendants. Globs in existing
// work-items (event*.ts, *.test.mjs, src/**/foo.ts) also need intersection
// checks; treating "*" as a literal silently grants two writers one file.
// This is a small glob-language intersection check, not filesystem expansion:
// it also catches conflicts for files that have not been created yet.
function tokenizeOwnedGlob(value) {
  const tokens = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "*" && value[i + 1] === "*") {
      tokens.push({kind:"globstar"});
      i++;
    } else if (value[i] === "*") tokens.push({kind:"star"});
    else if (value[i] === "?") tokens.push({kind:"any"});
    else tokens.push({kind:"literal",char:value[i]});
  }
  return tokens;
}

function globLanguagesIntersect(left, right) {
  const a = tokenizeOwnedGlob(left), b = tokenizeOwnedGlob(right);
  const alphabet = new Set(["/", "\u0000"]);
  for (const t of [...a, ...b]) if (t.kind === "literal") alphabet.add(t.char);
  const closure = (tokens, initial) => {
    const states = new Set(initial), pending = [...initial];
    for (const index of pending) {
      if (index < tokens.length && ["star","globstar"].includes(tokens[index].kind) && !states.has(index+1)) {
        states.add(index+1);
        pending.push(index+1);
      }
    }
    return [...states].sort((x,y)=>x-y);
  };
  const advance = (tokens, states, char) => {
    const next = new Set();
    for (const index of states) {
      const token = tokens[index];
      if (!token) continue;
      if (token.kind === "literal" && token.char === char || token.kind === "any" && char !== "/") next.add(index+1);
      else if (token.kind === "globstar" || token.kind === "star" && char !== "/") next.add(index);
    }
    return closure(tokens, next);
  };
  const first = [closure(a,[0]),closure(b,[0])], queue = [first], seen = new Set();
  for (let i=0; i<queue.length; i++) {
    const [leftStates,rightStates] = queue[i], key = leftStates.join(",")+"|"+rightStates.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (leftStates.includes(a.length) && rightStates.includes(b.length)) return true;
    for (const char of alphabet) {
      const nextLeft = advance(a,leftStates,char), nextRight = advance(b,rightStates,char);
      if (nextLeft.length && nextRight.length) queue.push([nextLeft,nextRight]);
    }
  }
  return false;
}

function ownedGlobForms(value) {
  // "**/" may represent zero or more path segments. Include the zero-depth
  // form as well as the literal globstar form for each occurrence.
  const forms = new Set([value, value+"/**"]);
  // Set iteration includes newly added forms; visit successive zero-depth
  // variants so multiple "/**/" segments cannot conceal an overlapping owner.
  for (const form of forms) {
    const index = form.indexOf("/**/");
    if (index >= 0) forms.add(form.slice(0,index+1)+form.slice(index+4));
  }
  return forms;
}

function ownedPathsOverlap(left, right) {
  // Only known, explicitly scoped legacy notes may carry separate ownership.
  // Arbitrary suffixes such as "(ignore)" must not turn a real file/glob
  // collision into an unchecked literal string comparison.
  // Broad "MIG-XXXX files" claims still require live-PR diff inspection:
  // the checkpoint text alone does not enumerate that subset.
  const note = / \(([^()]*)\)$/;
  const recognizedScope = value => {
    const suffix = note.exec(value)?.[1];
    return suffix !== undefined && (
      /^MIG-\d{4} files$/.test(suffix) ||
      /^(?:MIG-\d{4} )?(?:mount lines only|spreadsheet vars only)$/.test(suffix)
    );
  };
  if (recognizedScope(left) || recognizedScope(right)) return left === right;
  // An unknown note is not an ownership partition: compare its path normally.
  left = left.replace(note, "");
  right = right.replace(note, "");
  if (left === right || left.startsWith(right + "/") || right.startsWith(left + "/")) return true;
  if (!/[?*]/.test(left) && !/[?*]/.test(right)) return false;
  for (const a of ownedGlobForms(left)) {
    for (const b of ownedGlobForms(right)) {
      if (globLanguagesIntersect(a,b)) return true;
    }
  }
  return false;
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
      else if(commitExists && !commitExists(map.Head))errors.push(filename+": source SHA is not an available Git commit: "+map.Head+"; fetch full history / node scripts/check-migration-work-items.mjs --fetch-pr-history");
      if(!map["Owned paths"]||map["Owned paths"]==="none")errors.push(filename+": missing owned paths");
      if(!map["Current unit"]||map["Current unit"]==="none")errors.push(filename+": missing micro-unit");
      for(const [label,value,seen] of [["PR",map.PR,prs],["Branch",map.Branch,branches]]) {
        if(value&&value!=="none"){if(seen.has(value))errors.push(filename+": "+label+" also claimed by "+seen.get(value));else seen.set(value,filename);}
      }
      if(activeStates.has(map.State))for(const p of (map["Owned paths"]||"").split(";").map(x=>x.trim()).filter(x=>x&&x!=="none")){
        const normalized=canonicalOwnedPath(p);
        if (normalized === null) {
          errors.push(filename+": invalid owned path "+p+" (expected repository-relative path or dir/**)");
          continue;
        }
        // A path may carry at most one trailing explanatory scope note.
        // Two notes can otherwise hide the real path from ownedPathsOverlap,
        // and a nonterminal note can bypass both scope owner and file checks.
        // Exactly one non-nested trailing annotation is allowed, if any.
        // matchAll() misses malformed nested notes such as "(reason(one))":
        // those would otherwise be compared as literal filename characters.
        const firstNote=normalized.indexOf(" (");
        const suffixNote=/ \([^()]*\)$/.exec(normalized);
        if(firstNote>=0 && (!suffixNote || suffixNote.index!==firstNote)) {
          errors.push(filename+": ambiguous owned path annotations: "+p);
          continue;
        }
        // Check the canonical spelling: trailing slash or "/." after a
        // qualified claim must not bypass the MIG owner identity check.
        const scopedOwner=normalized.match(/ \((MIG-\d{4}) (?:files|mount lines only|spreadsheet vars only)\)$/)?.[1];
        if(scopedOwner && scopedOwner!==id) {
          errors.push(filename+": scoped owned path "+p+" names "+scopedOwner+" instead of "+id);
          continue;
        }
        const collision=[...claimed].find(([existing])=>ownedPathsOverlap(existing,normalized));
        if(collision)errors.push(filename+": path "+p+" already claimed by "+collision[1]+" ("+collision[0]+")");
        else claimed.set(normalized,filename);
      }
    }
    if(["REVIEW","DONE"].includes(map.State))for(const f of ["Validation","Evidence"]){
      if(!map[f]||/^(none|not run|pending)/i.test(map[f]))errors.push(filename+": "+f+" required for "+map.State);
    }
    if(map.State==="BLOCKED"&&(!map.Next||map.Next==="none"))errors.push(filename+": missing resume condition");
  }
  return errors;
}

// Missing historical commits are an independent precondition from ownership errors.
// Always attempt explicit history retrieval when requested; do not create dozens of
// misleading missing-SHA diagnostics merely because another structural check failed.
// Structural errors remain fatal after fetching: this is never a fail-open path.
export function validateWithHistory({statusText,entries,commitExists,fetchHistory}) {
  const errors=validateWorkItems({statusText,entries});
  if(fetchHistory) {
    try { fetchHistory(); }
    catch { errors.push("could not fetch required PR history from origin; verify repository access and recorded PR numbers"); }
  }
  errors.push(...validateWorkItems({statusText,entries,commitExists}).filter(error=>!errors.includes(error)));
  return errors;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const statusText=fs.readFileSync(path.join(root,"docs/migration/STATUS.md"),"utf8"),entries=readWorkItems(root);
  const errors=validateWithHistory({
    statusText, entries,
    commitExists: value => gitCommitExists(root,value),
    fetchHistory: process.argv.includes("--fetch-pr-history") ? () => fetchMissingSourceHistory(root,entries) : undefined,
  });
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
