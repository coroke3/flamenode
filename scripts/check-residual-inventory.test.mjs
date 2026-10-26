import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {checkResidualInventory,extractConfigRows,readInventoryRows} from "./check-residual-inventory.mjs";

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
  assert.throws(()=>readInventoryRows(docs.replace("\n## 2.", "\n"+entry+"## 2.")),/duplicate inventory row/);
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

test("T10: KV identifier change is redacted and flagged",()=>{
  const changed=web.replace('\nid = "00000000000000000000000000000000"','\nid = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"');
  assert.notEqual(changed,web);
  const r=checkResidualInventory({sources:{"wrangler.toml":changed}});
  assert.ok(r.missing.some(x=>x.kind==="kv.binding"&&x.value==="non-placeholder ID (redacted)"));
  assert.equal(JSON.stringify(r).includes("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),false);
});
