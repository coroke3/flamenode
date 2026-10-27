import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {parseFileRows,collectFiles} from "./check-migration-file-progress.mjs";
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

test("T30: Queue producer cannot reuse an existing D1 Env binding name",()=>{
  const modified=web.replace('binding = "NOTIFICATION_WAKE_QUEUE"','binding = "DB"');
  assert.notEqual(modified,web);
  assert.throws(()=>extractConfigRows(modified,"wrangler.toml"),
    /binding name collision DB \(queue\.producer and d1\.binding\)/);
});

test("T31: service binding cannot reuse the Static Assets Env binding name",()=>{
  const modified=web.replace('binding = "WORKER_SELF_REFERENCE"','binding = "ASSETS"');
  assert.notEqual(modified,web);
  assert.throws(()=>extractConfigRows(modified,"wrangler.toml"),
    /binding name collision ASSETS \(asset\.binding and service\.binding\)/);
});

test("T32: a Queue consumer name matching the producer queue does not cause an Env binding collision",()=>{
  // Consumer queue names are not Env binding names and may intentionally
  // match a producer queue. Check a real mixed producer/consumer Worker.
  const rows=extractConfigRows(fast,fastPath);
  assert.ok(rows.some(r=>r.kind==="queue.producer"));
  assert.ok(rows.some(r=>r.kind==="queue.consumer"));
});

test("T33: all three existing MIG-0908 files are registered in the validated migration ledger",()=>{
  const matrix=readFileSync(resolve(root,"docs/migration/FILE_MIGRATION_MATRIX.md"),"utf8");
  const {rows,errors}=parseFileRows(matrix);
  assert.deepEqual(errors,[]);
  const registered=new Map([
    ["docs/migration/RESIDUAL_INVENTORY.md","CONFIG"],
    ["scripts/check-residual-inventory.mjs","HELPER"],
    ["scripts/check-residual-inventory.test.mjs","TEST"]
  ]);
  for(const [path,kind] of registered){
    const row=rows.get(path);
    assert.ok(row,`${path} must be in the Migration ledger, not the future-file list`);
    assert.equal(row.kind,kind);
    assert.equal(row.owner,"MIG-0908");
    assert.equal(row.state,"IN_PROGRESS");
    assert.match(row.evidence,/PR#416 SHA=[0-9a-f]{40}/);
  }
});

test("T34: migration progress scanner can verify existing migration docs and scripts",()=>{
  const existing=new Set(collectFiles(root));
  for(const file of [
    "docs/migration/RESIDUAL_INVENTORY.md",
    "scripts/check-residual-inventory.mjs",
    "scripts/check-residual-inventory.test.mjs",
    "scripts/check-migration-file-progress.mjs"
  ]) assert.ok(existing.has(file),`migration ledger source not discovered: ${file}`);
});

test("T35: Wrangler vars cannot shadow a D1 binding in the Worker Env namespace",()=>{
  const changed=web.replace('NEXT_PUBLIC_SITE_NAME = "FlameNode"','DB = "FlameNode"');
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    /binding name collision DB \(vars and d1\.binding\)/);
});

test("T36: repeated vars keys are rejected without looking at var values",()=>{
  const changed=web.replace('NEXT_PUBLIC_SITE_NAME = "FlameNode"',
    'NEXT_PUBLIC_SITE_NAME = "FlameNode"\nNEXT_PUBLIC_SITE_NAME = "shadow"');
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    /duplicate vars key NEXT_PUBLIC_SITE_NAME/);
});

test("T37: malformed vars assignment does not expose the value in diagnostics",()=>{
  const marker="private-diagnostic-marker-123456";
  const changed=web.replace('NEXT_PUBLIC_SITE_NAME = "FlameNode"',
    "NEXT_PUBLIC_SITE_NAME := "+marker);
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    error=>error.message.includes("unsupported syntax (value redacted)") &&
      !error.message.includes(marker));
});

test("T38: removing a background KV preview_id requires review",()=>{
  const changed=fast.replace('preview_id = "00000000000000000000000000000000"',"");
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    /unexpected KV preview_id presence/);
});

test("T39: adding KV preview_id to the web Worker requires review",()=>{
  const changed=web.replace(
    'id = "00000000000000000000000000000000"',
    'id = "00000000000000000000000000000000"\npreview_id = "00000000000000000000000000000000"');
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /unexpected KV preview_id presence/);
});

test("T40: removing the web D1 migration directory cannot evade inventory audit",()=>{
  const changed=web.replace('migrations_dir = "migrations"',"");
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /unexpected D1 migrations_dir/);
});

test("T41: changing the web D1 migration directory cannot evade inventory audit",()=>{
  const changed=web.replace('migrations_dir = "migrations"',
    'migrations_dir = "other-migrations"');
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /unexpected D1 migrations_dir/);
});

test("T42: adding a D1 migration directory on a background Worker requires review",()=>{
  const changed=fast.replace(
    'database_id = "00000000-0000-0000-0000-000000000000"',
    'database_id = "00000000-0000-0000-0000-000000000000"\nmigrations_dir = "migrations"');
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    /unexpected D1 migrations_dir/);
});

test("T43: alternate root Wrangler JSON/JSONC configs cannot shadow the audited TOML",()=>{
  const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-root-"));
  try {
    mkdirSync(resolve(temp,"workers"));
    writeFileSync(resolve(temp,"wrangler.json"),'{"name":"alternate"}');
    writeFileSync(resolve(temp,"wrangler.jsonc"),'{"name":"alternate"}');
    assert.deepEqual(findUntrackedWorkerConfigs(temp),["wrangler.json","wrangler.jsonc"]);
    const sources={"wrangler.toml":web,[fastPath]:fast,[contentPath]:content,[syncPath]:sync};
    assert.throws(()=>checkResidualInventory({root:temp,markdown:docs,sources}),
      /unreviewed Worker Wrangler configs: wrangler.json, wrangler.jsonc/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test("T44: symlinked Worker Wrangler configurations cannot bypass discovery",
  {skip:process.platform==="win32"},()=>{
    const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-links-"));
    try {
      const worker=resolve(temp,"workers","fast-jobs");
      mkdirSync(worker,{recursive:true});
      const target=resolve(temp,"external.toml");
      writeFileSync(target,'name = "unexpected"\n');
      symlinkSync(target,resolve(worker,"wrangler.toml"));
      assert.deepEqual(findUntrackedWorkerConfigs(temp),["workers/fast-jobs/wrangler.toml"]);
    } finally { rmSync(temp,{recursive:true,force:true}); }
  });

test("T45: an unsafe TOML Queue integer cannot silently round into an audited value",()=>{
  const big="9007199254740993";
  const changed=fast.replace("max_concurrency = 1","max_concurrency = "+big);
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    error=>/unsafe TOML integer \(value redacted\)/.test(error.message)&&
      !error.message.includes(big));
});

test("T46: zero Queue batch size is invalid even if documented",()=>{
  const changed=fast.replace("max_batch_size = 10","max_batch_size = 0");
  assert.notEqual(changed,fast);
  assert.throws(()=>extractConfigRows(changed,fastPath),/invalid consumer limit range/);
});

test("T47: negative Queue retry and delay settings are rejected",()=>{
  for(const [key,valid,bad] of [
    ["max_retries",3,-1],
    ["retry_delay",60,-60]
  ]){
    const changed=fast.replace(`${key} = ${valid}`,`${key} = ${bad}`);
    assert.notEqual(changed,fast);
    assert.throws(()=>extractConfigRows(changed,fastPath),/invalid consumer limit range/);
  }
});

test("T48: zero Queue concurrency is rejected while zero retries remain valid",()=>{
  const invalid=fast.replace("max_concurrency = 1","max_concurrency = 0");
  assert.notEqual(invalid,fast);
  assert.throws(()=>extractConfigRows(invalid,fastPath),/invalid consumer limit range/);
  const valid=fast.replace("max_retries = 3","max_retries = 0");
  assert.notEqual(valid,fast);
  const rows=extractConfigRows(valid,fastPath);
  assert.ok(rows.some(row=>row.kind==="queue.consumer" && row.value.includes("retry 0")));
});

test("T49: symlinked Worker directory cannot hide an additional Wrangler config",
  {skip:process.platform==="win32"},()=>{
    const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-dirlink-"));
    try {
      const external=resolve(temp,"external-worker");
      mkdirSync(external,{recursive:true});
      mkdirSync(resolve(temp,"workers"));
      writeFileSync(resolve(external,"wrangler.toml"),'name = "hidden"\n');
      symlinkSync(external,resolve(temp,"workers","linked-worker"),"dir");
      assert.deepEqual(findUntrackedWorkerConfigs(temp),["workers/linked-worker"]);
    } finally { rmSync(temp,{recursive:true,force:true}); }
  });

test("T50: symlinked root Wrangler TOML requires review even if its contents match",
  {skip:process.platform==="win32"},()=>{
    const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-rootlink-"));
    try {
      mkdirSync(resolve(temp,"workers"));
      const external=resolve(temp,"source.toml");
      writeFileSync(external,web);
      symlinkSync(external,resolve(temp,"wrangler.toml"),"file");
      assert.deepEqual(findUntrackedWorkerConfigs(temp),["wrangler.toml"]);
    } finally { rmSync(temp,{recursive:true,force:true}); }
  });

test("T51: commented-out Workers Builds guard is not treated as an active command",()=>{
  const guard='command = "node scripts/workers-ci-wrangler-guard.mjs"';
  const changed=web.replace(guard,"# "+guard);
  assert.notEqual(changed,web);
  assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
    /expected guarded build\.command/);
});

test("T52: altered or malformed build command fails closed without printing values",()=>{
  const guard='command = "node scripts/workers-ci-wrangler-guard.mjs"';
  const marker="do-not-leak-build-value-45678";
  const changed=web.replace(guard,'command = "'+marker+'"');
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    error=>error.message.includes("expected guarded build.command") &&
      !error.message.includes(marker));
  const malformed=web.replace(guard,"command = "+marker);
  assert.throws(()=>extractConfigRows(malformed,"wrangler.toml"),
    error=>error.message.includes("unsupported TOML value (redacted)") &&
      !error.message.includes(marker));
});

test("T53: removing the entire build block cannot disable the guard unnoticed",()=>{
  const block='[build]\ncommand = "node scripts/workers-ci-wrangler-guard.mjs"\n';
  const changed=web.replace(block,"");
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    /missing guarded \[build\] section/);
});

test("T54: unknown build keys and unexpected background builds require review",()=>{
  const changed=web.replace(
    'command = "node scripts/workers-ci-wrangler-guard.mjs"',
    'run = "node scripts/workers-ci-wrangler-guard.mjs"');
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    /unreviewed build key run/);
  const background=fast+'\n[build]\ncommand = "node scripts/workers-ci-wrangler-guard.mjs"\n';
  assert.throws(()=>extractConfigRows(background,fastPath),
    /unreviewed background Worker build section/);
});

test("T55: linked workers root is rejected without traversing an external directory",
  {skip:process.platform==="win32"},()=>{
    const temp=mkdtempSync(resolve(tmpdir(),"flamenode-inventory-rootworkers-"));
    try {
      const external=resolve(temp,"external-workers");
      mkdirSync(external,{recursive:true});
      writeFileSync(resolve(external,"wrangler.toml"),'name = "unexpected"\n');
      symlinkSync(external,resolve(temp,"workers"),"dir");
      assert.deepEqual(findUntrackedWorkerConfigs(temp),["workers"]);
    } finally { rmSync(temp,{recursive:true,force:true}); }
  });

test("T56: invalid Wrangler vars values fail closed without echoing their contents",()=>{
  const marker="never-log-malformed-value-823649";
  const changed=sync.replace('GA4_SYNC_ENABLED = "0"',"GA4_SYNC_ENABLED = "+marker);
  assert.notEqual(changed,sync);
  assert.throws(()=>checkResidualInventory({sources:{[syncPath]:changed}}),
    error=>/invalid vars TOML value \(redacted\)/.test(error.message) &&
      !error.message.includes(marker));
});

test("T57: valid vars values remain outside the resource inventory",()=>{
  const changed=web.replace('NEXT_PUBLIC_SITE_NAME = "FlameNode"',
    'NEXT_PUBLIC_SITE_NAME = "Renamed for test"');
  assert.notEqual(changed,web);
  const r=checkResidualInventory({sources:{"wrangler.toml":changed}});
  assert.deepEqual(r.missing,[]);
  assert.deepEqual(r.stale,[]);
  assert.equal(r.declaredCount,36);
});

test("T58: valid vars trailing comments and escaped TOML strings still parse",()=>{
  const changed=sync.replace('GA4_SYNC_ENABLED = "0"',
    'GA4_SYNC_ENABLED = "0" # local setting');
  assert.notEqual(changed,sync);
  const r=checkResidualInventory({sources:{[syncPath]:changed}});
  assert.deepEqual(r.missing,[]);
  assert.deepEqual(r.stale,[]);
});

test("T59: leading-zero TOML Queue integers never normalize to the audited value",()=>{
  for(const invalid of ["01","-01"]) {
    const changed=fast.replace("max_concurrency = 1","max_concurrency = "+invalid);
    assert.notEqual(changed,fast);
    assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
      error=>/unsupported TOML value \(redacted\)/.test(error.message));
  }
  const vars=sync.replace('GA4_SYNC_ENABLED = "0"',"GA4_SYNC_ENABLED = 01");
  assert.notEqual(vars,sync);
  assert.throws(()=>extractConfigRows(vars,syncPath),/invalid vars TOML value \(redacted\)/);
});

test("T60: JSON-only slash escapes are invalid in TOML values",()=>{
  const invalid='GA4_SYNC_ENABLED = "bad\\/escape"';
  const changed=sync.replace('GA4_SYNC_ENABLED = "0"',invalid);
  assert.notEqual(changed,sync);
  assert.throws(()=>checkResidualInventory({sources:{[syncPath]:changed}}),
    error=>/invalid vars TOML value \(redacted\)/.test(error.message) &&
      !error.message.includes("bad"));
  const queue=fast.match(/^queue = "[^"]+"$/m)?.[0];
  assert.ok(queue);
  const changedQueue=fast.replace(queue,'queue = "bad\\/escape"');
  assert.throws(()=>extractConfigRows(changedQueue,fastPath),/invalid TOML quoted string/);
});

test("T61: legitimate TOML basic escapes parse while invalid Unicode is rejected",()=>{
  const valid='GA4_SYNC_ENABLED = "tab\\t unicode\\u00e9 emoji\\U0001F600 backslash\\\\"';
  const changed=sync.replace('GA4_SYNC_ENABLED = "0"',valid);
  assert.notEqual(changed,sync);
  const result=checkResidualInventory({sources:{[syncPath]:changed}});
  assert.deepEqual(result.missing,[]);
  assert.deepEqual(result.stale,[]);
  assert.equal(result.declaredCount,36);
  for(const invalid of ["\\uD800","\\U00110000","\\x41"]) {
    const source=sync.replace('GA4_SYNC_ENABLED = "0"',
      'GA4_SYNC_ENABLED = "'+invalid+'"');
    assert.throws(()=>extractConfigRows(source,syncPath),
      /invalid vars TOML value \(redacted\)/);
  }
});

test("T62: changing or removing root workers_dev requires route-exposure review",()=>{
  const flag="workers_dev = true";
  assert.ok(web.includes(flag));
  for(const changed of [web.replace(flag,"workers_dev = false"),web.replace(flag,"")]){
    assert.notEqual(changed,web);
    assert.throws(()=>checkResidualInventory({sources:{"wrangler.toml":changed}}),
      /expected root workers_dev = true \(review required\)/);
  }
});

test("T63: adding workers_dev to a background Worker requires review",()=>{
  const changed=fast.replace("minify = true","minify = true\nworkers_dev = false");
  assert.notEqual(changed,fast);
  assert.throws(()=>checkResidualInventory({sources:{[fastPath]:changed}}),
    /unexpected background workers_dev \(review required\)/);
});

test("T64: invalid observability TOML is rejected and its contents redacted",()=>{
  const marker="never-show-observability-value-456";
  for(const [path,source] of [["wrangler.toml",web],[fastPath,fast],[contentPath,content],[syncPath,sync]]) {
    const changed=source.replace("[observability]\nenabled = true",
      "[observability]\nenabled = "+marker);
    assert.notEqual(changed,source);
    assert.throws(()=>extractConfigRows(changed,path),
      error=>/unsupported TOML value \(redacted\)/.test(error.message)&&
        !error.message.includes(marker));
  }
});

test("T65: invalid placement TOML is rejected, not silently ignored",()=>{
  const marker="unquoted-unreviewed-placement";
  const changed=web.replace('mode = "smart"',"mode = "+marker);
  assert.notEqual(changed,web);
  assert.throws(()=>extractConfigRows(changed,"wrangler.toml"),
    error=>/unsupported TOML value \(redacted\)/.test(error.message)&&
      !error.message.includes(marker));
});

test("T66: unreviewed observability/placement fields fail closed",()=>{
  const obs=web.replace("enabled = true","enabled = true\nlogs = true");
  const placement=web.replace('mode = "smart"','mode = "smart"\nregion = "EU"');
  assert.throws(()=>extractConfigRows(obs,"wrangler.toml"),
    /unreviewed observability key logs/);
  assert.throws(()=>extractConfigRows(placement,"wrangler.toml"),
    /unreviewed placement key region/);
});

test("T67: tracked observability and placement semantics cannot silently drift",()=>{
  const baseline=checkResidualInventory();
  assert.equal(baseline.declaredCount,36);
  assert.deepEqual(baseline.missing,[]);
  assert.deepEqual(baseline.stale,[]);
  const obsOff=web.replace("enabled = true","enabled = false");
  const placementChanged=web.replace('mode = "smart"','mode = "off"');
  const withoutObservability=fast.replace("[observability]\nenabled = true\n","");
  const withoutPlacement=web.replace('[placement]\nmode = "smart"\n',"");
  const background=fast.replace("[observability]\nenabled = true",
    '[observability]\nenabled = true\n[placement]\nmode = "smart"');
  assert.throws(()=>extractConfigRows(obsOff,"wrangler.toml"),
    /expected observability.enabled = true/);
  assert.throws(()=>extractConfigRows(placementChanged,"wrangler.toml"),
    /unexpected placement.mode/);
  assert.throws(()=>extractConfigRows(withoutObservability,fastPath),
    /missing \[observability\] section/);
  assert.throws(()=>extractConfigRows(withoutPlacement,"wrangler.toml"),
    /missing \[placement\] section/);
  assert.throws(()=>extractConfigRows(background,fastPath),
    /unexpected placement.mode/);
});
