#!/usr/bin/env node
/**
 * MIG-0908: compare checked-in Wrangler declarations with the code-side
 * inventory. Strict for audited sections; never queries Cloudflare.
 */
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

export const CONFIGS = [
  "wrangler.toml",
  "workers/fast-jobs/wrangler.toml",
  "workers/content-jobs/wrangler.toml",
  "workers/sync-jobs/wrangler.toml"
];
const KNOWN = new Set(["","triggers","assets","services","queues.producers",
  "queues.consumers","d1_databases","r2_buckets","kv_namespaces"]);
const ARRAY_SECTIONS = new Set(["services","queues.producers","queues.consumers",
  "d1_databases","r2_buckets","kv_namespaces"]);
// Fail closed on unreviewed binding families. Inert sections have no bindings.
const INERT_SECTIONS = new Set(["build","observability","placement","vars"]);
const ALLOWED_KEYS = {
  "": ["name","main","compatibility_date","compatibility_flags","workers_dev","minify"],
  triggers: ["crons"],
  assets: ["directory","binding","run_worker_first"],
  services: ["binding","service"],
  "queues.producers": ["binding","queue"],
  "queues.consumers": ["queue","dead_letter_queue","max_batch_size",
    "max_batch_timeout","max_retries","retry_delay","max_concurrency"],
  d1_databases: ["binding","database_name","database_id","migrations_dir"],
  r2_buckets: ["binding","bucket_name"],
  kv_namespaces: ["binding","id","preview_id"]
};
const D1_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const KV_PLACEHOLDER_ID = "00000000000000000000000000000000";
const clean = value => String(value).replaceAll(String.fromCharCode(96),"").trim();
const signature = r => [r.config,r.kind,r.setting,r.value].map(clean).join("|");
const record = (config,kind,setting,value) => ({config,kind,setting,value});

function removeComment(line) {
  let quote = "", escape = false;
  for(let i=0;i<line.length;i++) {
    const c = line[i];
    if(escape) {escape=false;continue;}
    if(quote==='"' && c==="\\") {escape=true;continue;}
    if(quote) {if(c===quote) quote="";continue;}
    if(c==='"'||c==="'") quote=c;
    else if(c==="#") return line.slice(0,i).trim();
  }
  if(quote) throw Error("unclosed TOML string");
  return line.trim();
}
function scalar(value) {
  if(value.startsWith('"') && value.endsWith('"')) {
    try {return JSON.parse(value);} catch {throw Error("invalid TOML quoted string");}
  }
  if(value.startsWith("'") && value.endsWith("'")) return value.slice(1,-1);
  if(/^-?\d+$/.test(value)) return Number(value);
  if(value==="true"||value==="false") return value==="true";
  throw Error("unsupported TOML value (redacted)");
}
function decode(value) {
  if(!value.startsWith("[")) return scalar(value);
  if(!value.endsWith("]")) throw Error("unsupported multiline TOML array");
  const inner=value.slice(1,-1).trim();
  if(!inner) return [];
  const tokens=inner.match(/"(?:[^"\\]|\\.)*"|'[^']*'/g)||[];
  if(tokens.join(",").replace(/\s/g,"")!==inner.replace(/\s/g,"")) throw Error("unsupported TOML array");
  return tokens.map(scalar);
}
function required(fields,key,where) {
  if(typeof fields[key]!=="string" || !fields[key]) throw Error(where+": missing "+key);
  return fields[key];
}
export function extractConfigRows(source,config) {
  if(!CONFIGS.includes(config)) throw Error("unsupported config: "+config);
  const blocks=[{section:"",fields:{},line:1}];
  const singletonSections=new Set();
  source.split(/\r?\n/).forEach((raw,index)=>{
    let line;
    try {line=removeComment(raw);} catch(e){throw Error(config+":"+(index+1)+": "+e.message);}
    if(!line) return;
    if(line.startsWith("[")) {
      const m=/^(\[\[?)([\w.-]+)(\]\]?)$/.exec(line);
      if(!m || (m[1].length!==m[3].length)) throw Error(config+":"+(index+1)+": invalid section");
      if(ARRAY_SECTIONS.has(m[2]) && m[1]!=="[[")
        throw Error(config+":"+(index+1)+": expected array section "+m[2]);
      if(!ARRAY_SECTIONS.has(m[2]) && m[1]!=="[")
        throw Error(config+":"+(index+1)+": expected singleton section "+m[2]);
      if(!KNOWN.has(m[2]) && !INERT_SECTIONS.has(m[2]))
        throw Error(config+":"+(index+1)+": unreviewed TOML section "+m[2]);
      if(m[1]==="[") {
        if(singletonSections.has(m[2]))
          throw Error(config+":"+(index+1)+": duplicate TOML section "+m[2]);
        singletonSections.add(m[2]);
      }
      blocks.push({section:m[2],fields:{},line:index+1});
      return;
    }
    const block=blocks.at(-1), m=/^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line);
    if(!m) {
      if(KNOWN.has(block.section)) throw Error(config+":"+(index+1)+": unsupported syntax (value redacted)");
      return;
    }
    if(KNOWN.has(block.section)) {
      if(!ALLOWED_KEYS[block.section]?.includes(m[1]))
        throw Error(config+":"+(index+1)+": unreviewed "+block.section+" key "+m[1]);
      if(Object.hasOwn(block.fields,m[1])) throw Error(config+":"+(index+1)+": duplicate "+m[1]);
      try {block.fields[m[1]]=decode(m[2].trim());}
      catch(e){throw Error(config+":"+(index+1)+": "+e.message);}
    }
  });
  const rows=[];
  blocks.forEach(({section,fields:d,line})=>{
    const where=config+":"+line+" ["+section+"]";
    const req=k=>required(d,k,where);
    const add=(kind,key,value)=>rows.push(record(config,kind,key,value));
    if(section==="") {
      if("name" in d) add("worker.name","name",req("name"));
      if("main" in d) add("worker.main","main",req("main"));
    } else if(section==="triggers") {
      if(!Array.isArray(d.crons)) throw Error(where+": missing crons array");
      d.crons.forEach(v=>{
        if(typeof v!=="string"||!v) throw Error(where+": invalid cron");
        add("cron","triggers.crons",v);
      });
    } else if(section==="assets") {
      // A true run_worker_first sends every asset request through the Worker.
      // This can change public 404/visibility behavior; review via its own MIG
      // before enabling it on the tracked legacy Worker template.
      if(d.run_worker_first!==false)
        throw Error(where+": expected explicit assets.run_worker_first = false");
      add("asset.binding",req("binding"),req("directory"));
    }
    else if(section==="services") add("service.binding",req("binding"),req("service"));
    else if(section==="queues.producers") add("queue.producer",req("binding"),req("queue"));
    else if(section==="queues.consumers") {
      const name=req("queue"), dlq=req("dead_letter_queue");
      const keys=["max_batch_size","max_batch_timeout","max_retries","retry_delay","max_concurrency"];
      if(!keys.every(k=>Number.isInteger(d[k]))) throw Error(where+": missing consumer batch/timeout/retry/delay/concurrency");
      add("queue.consumer",name,"DLQ "+dlq+"; batch "+d.max_batch_size+"; timeout "+d.max_batch_timeout+
        "; retry "+d.max_retries+"; delay "+d.retry_delay+"; concurrency "+d.max_concurrency);
    } else if(section==="d1_databases") {
      // Tracked templates must not embed a real D1 database identifier.
      // Production uses separately generated config, never printed here.
      if(req("database_id")!==D1_PLACEHOLDER_ID)
        throw Error(where+": non-placeholder D1 identifier in tracked config (redacted)");
      add("d1.binding",req("binding"),req("database_name"));
    }
    else if(section==="r2_buckets") add("r2.binding",req("binding"),req("bucket_name"));
    else if(section==="kv_namespaces") {
      if(req("id")!==KV_PLACEHOLDER_ID ||
          ("preview_id" in d && d.preview_id!==KV_PLACEHOLDER_ID))
        throw Error(where+": non-placeholder KV identifier in tracked config (redacted)");
      add("kv.binding",req("binding"),"checked-in placeholder ID");
    }
  });
  const seen=new Set();
  rows.forEach(r=>{
    const key=[r.config,r.kind,r.setting,r.kind==="cron"?r.value:""].join("|");
    if(seen.has(key)) throw Error("duplicate declaration: "+key);
    seen.add(key);
  });
  if(rows.filter(x=>x.kind==="worker.name").length!==1||rows.filter(x=>x.kind==="worker.main").length!==1)
    throw Error(config+": expected exactly one worker name and main");
  return rows;
}
export function readInventoryRows(markdown) {
  // Read only the first inventory table. Later subsection tables are
  // explanatory decision proposals, not Wrangler declaration records.
  const body=markdown.replace(/\r\n/g,"\n")
    .split("## 1. Tracked code-side inventory")[1]
    ?.split(/\n#{2,6}\s/)[0];
  if(!body) throw Error("inventory sections 1 and 2 required");
  const lines=body.split("\n").filter(x=>x.trim().startsWith("|"));
  const head=lines[0]?.split("|").slice(1,-1).map(clean).join("|");
  if(head!=="Config|Kind|Setting / binding|Value / resource|移行後の担当（Worker / MIG）|退役 MIG")
    throw Error("inventory table header mismatch");
  if(!/^\|(?:\s*:?-{3,}:?\s*\|){6}\s*$/.test(lines[1]??"")) throw Error("bad table separator");
  const seen=new Set();
  return lines.slice(2).map((line,i)=>{
    const cols=line.split("|").slice(1,-1).map(clean);
    if(cols.length!==6||cols.some(v=>!v)) throw Error("invalid inventory row "+(i+1));
    if(!CONFIGS.includes(cols[0])) throw Error("untracked inventory config: "+cols[0]);
    const r={...record(cols[0],cols[1],cols[2],cols[3]),owner:cols[4],retirement:cols[5]};
    const key=[r.config,r.kind,r.setting,r.kind==="cron"?r.value:""].join("|");
    if(seen.has(key)) throw Error("duplicate inventory row: "+key);
    seen.add(key);
    return r;
  });
}
export function checkResidualInventory({root,markdown,sources}={}) {
  const base=resolve(root??dirname(dirname(fileURLToPath(import.meta.url))));
  const docs=readInventoryRows(markdown??readFileSync(resolve(base,"docs/migration/RESIDUAL_INVENTORY.md"),"utf8"));
  const code=CONFIGS.flatMap(file=>extractConfigRows(sources?.[file]??readFileSync(resolve(base,file),"utf8"),file));
  const documentation=new Set(docs.map(signature)), declaration=new Set(code.map(signature));
  return {
    missing:code.filter(r=>!documentation.has(signature(r))),
    stale:docs.filter(r=>!declaration.has(signature(r))),
    unknown:docs.filter(r=>r.owner.includes("未定")||r.retirement.includes("未定")),
    declaredCount:code.length,documentedCount:docs.length
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const r=checkResidualInventory();
    r.missing.forEach(x=>console.error("MISSING: "+signature(x)));
    r.stale.forEach(x=>console.error("STALE: "+signature(x)));
    if(r.unknown.length) console.warn("WARN: "+r.unknown.length+" unresolved entries (MIG-0901)");
    if(r.missing.length||r.stale.length) process.exitCode=1;
    else console.log("PASS: "+r.declaredCount+" tracked config records");
  } catch(e){console.error("FAIL residual inventory: "+e.message);process.exitCode=1;}
}
