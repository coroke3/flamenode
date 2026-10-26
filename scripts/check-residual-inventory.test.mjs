import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {checkResidualInventory,extractConfigRows,readInventoryRows,findUntrackedWorkerConfigs} from "./check-residual-inventory.mjs";

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const docs=readFileSync(resolve(root,"docs/migration/RESIDUAL_INVENTORY.md"),"utf8");
const fastPath="workers/fast-jobs/wrangler.toml";
const syncPath="workers/sync-jobs/wrangler.toml";
const contentPath="workers/content-jobs/wrangler.toml";
const fast=readFileSync(resolve(root,fastPath),"utf8");
const sync=readFileSync(resolve(root,syncPath),"utf8");
const content=readFileSync(resolve(root,contentPath),"utf8");
const web=readFileSync(resolve(root,"wrangler.toml"),"utf8");
const tick=String.fromCharCode(96);

test("T01: actual four Wrangler configs match the checked-in inventory",()=>{
  const r=checkResidualInventory();
  assert.deepEqual(r.missing,[]);
  assert.deepEqual(r.stale,[]);
  assert.equal(r.declaredCount,36);
  assert.equal(r.documentedCount,36);
});

test("T02: adding a second cron identifies the missing expression",()=>{
  const mutated=fast.replace('crons = ["0 * * * *"]','crons = ["0 * * * *", "30 * * * *"]');
  assert.notEqual(mutated,fast);
  const r=checkResidualInventory({sources:{[fastPath]:mutated}});
  assert.deepEqual(r.missing.filter(x=>x.kind==="cron").map(x=>x.value),["30 * * * *"]);
});

test("T03: unresolved planned owner is a warning",()=>{
  const changed=docs.replace(" | MIG-0904 (after gates + approval) |"," | 未定 |");
  assert.notEqual(changed,docs);
  const r=checkResidualInventory({markdown:changed});
  assert.equal(r.missing.length,0);
  assert.equal(r.stale.length,0);
  assert.ok(r.unknown.length>0);
});

test("T04: renamed Queue producer is detected",()=>{
  const mutated=content.replace('queue = "flamenode-static-rebuild-wake"','queue = "renamed-static-queue"');
  assert.notEqual(mutated,content);
  const r=checkResidualInventory({sources:{[contentPath]:mutated}});
  assert.ok(r.missing.some(x=>x.kind==="queue.producer"&&x.value==="renamed-static-queue"));
  assert.ok(r.stale.some(x=>x.kind==="queue.producer"));
});

test("T05: consumer retry delay is a checked contract",()=>{
  const mutated=sync.replace("retry_delay = 300","retry_delay = 5");
  assert.notEqual(mutated,sync);
  const r=checkResidualInventory({sources:{[syncPath]:mutated}});
  assert.ok(r.missing.some(x=>x.kind==="queue.consumer"&&x.value.includes("delay 5")));
  assert.ok(r.stale.some(x=>x.kind==="queue.consumer"&&x.value.includes("delay 300")));
});

test("T06: adding an unknown R2 binding is detected",()=>{
  const extra='\n[[r2_buckets]]\nbinding = "EXTRA_R2"\nbucket_name = "extra-bucket"\n';
  const r=checkResidualInventory({sources:{"wrangler.toml":web+extra}});
  assert.ok(r.missing.some(x=>x.kind==="r2.binding"&&x.setting==="EXTRA_R2"));
});

test("T07: duplicate and stale table rows fail",()=>{
  const rows=readInventoryRows(docs);
  assert.equal(rows.length,36);
  const entry='| '+tick+'wrangler.toml'+tick+' | worker.name | '+tick+'name'+tick+' | '+tick+'flamenode-web'+tick+' | CURRENT | 未定 |\n';
  assert.throws(()=>readInventoryRows(docs.replace("\n### U03", "\n"+entry+"### U03")),/duplicate inventory row/);
  const orig='| '+tick+'wrangler.toml'+tick+' | worker.name | '+tick+'name'+tick+' | '+tick+'flamenode-web'+tick+' |';
  const modified=docs.replace(orig,orig.replace("flamenode-web","RENAMED"));
  assert.notEqual(modified,docs);
  assert.ok(checkResidualInventory({markdown:modified}).missing.some(x=>x.kind==="worker.name"));
});

test("T08: malformed audited sections and missing consumer options throw",()=>{
  assert.throws(()=>extractConfigRows(fast.replace("max_concurrency = 1",""),fastPath),/missing consumer batch/);
  assert.throws(()=>extractConfigRows(fast.replace('crons = ["0 * * * *"]','crons = [\n"0 * * * *"\n]'),fastPath),/unsupported multiline/);
});

test("T09: changed Worker entrypoint is detected",()=>{
  const modified=web.replace('main = ".open-next/worker.js"','main = "new-entry.js"');
  assert.notEqual(modified,web);
  assert.ok(checkResidualInventory({sources:{"wrangler.toml":modified}}).missing.some(x=>x.kind==="worker.main"));
});

test("T10: tracked KV ID changes fail closed without exposing identifiers",()=>{
  const id="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const changed=web.replace('\nid = "00000000000000000000000000000000"', '\nid = "'+id+'"');
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    error=>error.message.includes("non-placeholder KV")&&!error.message.includes(id));
});

test("T11: tracked D1 ID changes fail closed without exposing identifiers",()=>{
  const id="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const changed=web.replace(
    'database_id = "00000000-0000-0000-0000-000000000000"',
    'database_id = "'+id+'"');
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    error=>error.message.includes("non-placeholder D1")&&!error.message.includes(id));
});

test("T12: KV preview ID changes are not ignored",()=>{
  const id="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const changed=fast.replace(
    'preview_id = "00000000000000000000000000000000"',
    'preview_id = "'+id+'"');
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    error=>error.message.includes("non-placeholder KV")&&!error.message.includes(id));
});

test("T13: unrecognized binding sections fail closed",()=>{
  const mutated=fast+'\n[[durable_objects.bindings]]\nname = "DO"\nclass_name = "NewDO"\n';
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:mutated}}),
    /unreviewed TOML section durable_objects.bindings/);
});

test("T14: unreviewed keys on a known Queue binding fail closed",()=>{
  const mutated=content.replace(
    'binding = "STATIC_REBUILD_WAKE_QUEUE"',
    'binding = "STATIC_REBUILD_WAKE_QUEUE"\ndelivery_delay = 30');
  assert.notEqual(mutated,content);
  assert.throws(()=>checkResidualInventory({sources:{[contentPath]:mutated}}),
    /unreviewed queues.producers key delivery_delay/);
});

test("T15: a missing D1 database identifier fails closed",()=>{
  const changed=web.replace(
    'database_id = "00000000-0000-0000-0000-000000000000"',
    '');
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /missing database_id/);
});


test("T16: U03 proposal table is not mistaken for the audited configuration table",()=>{
  const rows=readInventoryRows(docs);
  assert.equal(rows.length,36);
  assert.ok(docs.includes("### U03 — DEV_ONLY"));
  const extended=docs.replace("\n## 2.", "\n| supplementary | proposal | not a config |\n## 2.");
  assert.equal(readInventoryRows(extended).length,36);
});

test("T17: changing asset routing to Worker-first requires explicit review",()=>{
  const changed=web.replace("run_worker_first = false","run_worker_first = true");
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /expected explicit assets\.run_worker_first = false/);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":web.replace("run_worker_first = false","")}}),
    /expected explicit assets\.run_worker_first = false/);
});

test("T18: malformed unquoted TOML IDs are never echoed in diagnostics",()=>{
  const marker="never-log-this-id-0987654321";
  const changed=fast.replace('id = "00000000000000000000000000000000"','id = '+marker);
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    error=>/unsupported TOML value \(redacted\)/.test(error.message)&&!error.message.includes(marker));
});

test("T19: duplicate singleton sections fail before inventory comparison",()=>{
  const extra=fast+"\n[triggers]\ncrons = [\"30 * * * *\"]\n";
  assert.throws(()=>extractConfigRows(extra,fastPath),/duplicate TOML section triggers/);
});

test("T20: repeating queue producer array sections remains supported",()=>{
  const changed=fast+'\n[[queues.producers]]\nqueue = "new-wake"\nbinding = "NEW_WAKE"\n';
  const result=checkResidualInventory({sources:{[fastPath]:changed}});
  assert.ok(result.missing.some(r=>r.kind==="queue.producer"&&r.setting==="NEW_WAKE"));
});


test("T21: array-style assets section is rejected (Wrangler expects singleton)",()=>{
  const changed=web.replace("\n[assets]\n","\n[[assets]]\n");
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    /expected singleton section assets/);
});

test("T22: cron array section is rejected",()=>{
  const changed=fast.replace("\n[triggers]\n","\n[[triggers]]\n");
  assert.notEqual(changed,fast);
  assert.throws(()=>extractConfigRows(changed,fastPath),
    /expected singleton section triggers/);
});

test("T23: malformed assignment never prints a credential-like value",()=>{
  const marker="sensitive-example-ID-123456789";
  const changed=web.replace('id = "00000000000000000000000000000000"',
    "id = "+marker+" =");
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    error=>error.message.includes("unsupported TOML value (redacted)") &&
      !error.message.includes(marker));
  const empty=web.replace('id = "00000000000000000000000000000000"',
    'id = "00000000000000000000000000000000"\nsecret := '+marker);
  assert.notEqual(empty,web);
  assert.throws(()=>extractConfigRows(empty,"wrangler.toml"),
    error=>error.message.includes("unsupported syntax (value redacted)") &&
      !error.message.includes(marker));
});

test("T24: CRLF ledger keeps U03 proposal table outside audited inventory",()=>{
  const crlf=docs.replace(/\n/g,"\r\n");
  const parsed=readInventoryRows(crlf);
  assert.equal(parsed.length,36);
  assert.deepEqual(checkResidualInventory({markdown:crlf}).missing,[]);
  assert.deepEqual(checkResidualInventory({markdown:crlf}).stale,[]);
});


test("T25: a newly added Worker Wrangler TOML cannot bypass the fixed four-file list",()=>{
  const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-"));
  try {
    const newDir=resolve(temp,"workers","experimental");
    mkdirSync(newDir,{recursive:true});
    writeFileSync(resolve(newDir,"wrangler.toml"),'name = "experimental"\nmain = "index.ts"\n');
    assert.deepEqual(findUntrackedWorkerConfigs(temp),["workers/experimental/wrangler.toml"]);
    const sources={
      "wrangler.toml":web,
      [fastPath]:fast,
      [contentPath]:content,
      [syncPath]:sync
    };
    assert.throws(()=>checkResidualInventory({root:temp,markdown:docs,sources}),
      /unreviewed Worker Wrangler configs: workers\/experimental\/wrangler.toml/);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});

test("T26: nested Worker JSONC and JSON deployment configs also require inventory review",()=>{
  const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-"));
  try {
    const nested=resolve(temp,"workers","new-worker","deploy");
    mkdirSync(nested,{recursive:true});
    writeFileSync(resolve(nested,"wrangler.jsonc"),'{"name":"test"}');
    writeFileSync(resolve(nested,"wrangler.json"),'{"name":"test"}');
    assert.deepEqual(findUntrackedWorkerConfigs(temp),[
      "workers/new-worker/deploy/wrangler.json",
      "workers/new-worker/deploy/wrangler.jsonc"
    ]);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});

test("T27: existing four tracked Wrangler files have no untracked workers",()=>{
  assert.deepEqual(findUntrackedWorkerConfigs(root),[]);
});

test("T28: embedded backtick in quoted Queue resource name cannot evade inventory drift",()=>{
  const modified=content.replace(
    'queue = "flamenode-static-rebuild-wake"',
    'queue = "flamenode-static-re`build-wake"');
  assert.notEqual(modified,content);
  const report=checkResidualInventory({sources:{[contentPath]:modified}});
  assert.ok(report.missing.some(r=>r.kind==="queue.producer"&&r.value.includes("re`build")));
  assert.ok(report.stale.some(r=>r.kind==="queue.producer"&&r.value==="flamenode-static-rebuild-wake"));
});

test("T29: whitespace within a quoted Worker entrypoint is not silently trimmed",()=>{
  const modified=web.replace(
    'main = ".open-next/worker.js"',
    'main = " .open-next/worker.js"');
  assert.notEqual(modified,web);
  const report=checkResidualInventory({sources:{"wrangler.toml":modified}});
  assert.ok(report.missing.some(r=>r.kind==="worker.main"&&r.value===" .open-next/worker.js"));
  assert.ok(report.stale.some(r=>r.kind==="worker.main"&&r.value===".open-next/worker.js"));
});
