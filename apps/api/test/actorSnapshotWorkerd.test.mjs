import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function stopTree(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => resolve();
    child.once("exit", done);
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2500);
  });
}

test("U04a-U04h: local workerd/D1 actor history, bounded reader, lease retention, measurements and backfill", { timeout: 120_000 }, async () => {
  const loggerSource = fs.readFileSync(path.join(REPO_ROOT, "packages/server-core/src/audit/logger.ts"), "utf8");
  assert.match(loggerSource, /discord_id: row\.discord_id \?\? null,[\s\S]*discord_name: row\.discord_name \?\? null,[\s\S]*x_user_id: row\.active_x_user_id \?\? null,[\s\S]*x_name: row\.x_name \?\? null,[\s\S]*icon_url: row\.x_icon_url \|\| row\.user_image \|\| null/);

  const wranglerBin = path.join(REPO_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  assert.ok(fs.existsSync(wranglerBin), "wrangler CLI missing from root node_modules");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-u04a-workerd-"));
  const stateDir = path.join(workDir, "state");
  const workerPath = path.join(workDir, "worker.mjs");
  const configPath = path.join(workDir, "wrangler.toml");
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;

  const workerSource = [
    "const actorSnapshotFromRow = row => ({",
    "  discord_id: row.discord_id ?? null,",
    "  discord_name: row.discord_name ?? null,",
    "  x_user_id: row.active_x_user_id ?? null,",
    "  x_name: row.x_name ?? null,",
    "  icon_url: row.x_icon_url || row.user_image || null,",
    "});",
    "const sourceSql = 'SELECT u.discord_id AS discord_id, u.name AS discord_name, u.active_x_user_id, u.image AS user_image, x.x_name, x.icon_url AS x_icon_url FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const versionsSql = 'SELECT u.actor_snapshot_version AS user_version, COALESCE(x.actor_snapshot_version, -1) AS x_version FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const historySql = 'SELECT u.discord_id AS discord_id, u.name AS discord_name, u.active_x_user_id, u.image AS user_image, x.x_name, x.icon_url AS x_icon_url FROM u04a_user_history u LEFT JOIN u04a_x_users_history x ON x.id = u.active_x_user_id AND x.version = ? WHERE u.id = ? AND u.version = ?';",
    "const historyByRefSql = 'SELECT u.discord_id AS discord_id, u.name AS discord_name, u.active_x_user_id, u.image AS user_image, x.x_name, x.icon_url AS x_icon_url FROM u04a_actor_history_refs r JOIN u04a_user_history u ON u.version = r.user_version LEFT JOIN u04a_x_users_history x ON x.version = r.x_version AND x.id = u.active_x_user_id WHERE r.id = ?';",
    "const historyListSql = 'SELECT r.id AS actor_ref_id, u.name AS discord_name, u.active_x_user_id AS x_user_id, x.x_name AS x_name FROM u04a_actor_history_refs r JOIN u04a_user_history u ON u.version = r.user_version LEFT JOIN u04a_x_users_history x ON x.version = r.x_version AND x.id = u.active_x_user_id WHERE r.id = ?';",
    "const leaseAcquireSql = 'INSERT INTO u04a_actor_history_leases (id, user_version, x_version, expires_at) SELECT ?, u.actor_snapshot_version, COALESCE(x.actor_snapshot_version, -1), NULL FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const leaseAcquireExpiringSql = 'INSERT INTO u04a_actor_history_leases (id, user_version, x_version, expires_at) SELECT ?, u.actor_snapshot_version, COALESCE(x.actor_snapshot_version, -1), 100 FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const cleanupUserHistorySql = 'DELETE FROM u04a_user_history WHERE version = ? AND NOT EXISTS (SELECT 1 FROM u04a_user u WHERE u.actor_snapshot_version = u04a_user_history.version) AND NOT EXISTS (SELECT 1 FROM u04a_actor_history_refs r WHERE r.user_version = u04a_user_history.version) AND NOT EXISTS (SELECT 1 FROM u04a_actor_history_leases l WHERE l.user_version = u04a_user_history.version AND (l.expires_at IS NULL OR l.expires_at > ?))';",
    "const cleanupXHistorySql = 'DELETE FROM u04a_x_users_history WHERE version = ? AND NOT EXISTS (SELECT 1 FROM u04a_x_users x WHERE x.actor_snapshot_version = u04a_x_users_history.version) AND NOT EXISTS (SELECT 1 FROM u04a_actor_history_refs r WHERE r.x_version = u04a_x_users_history.version) AND NOT EXISTS (SELECT 1 FROM u04a_actor_history_leases l WHERE l.x_version = u04a_x_users_history.version AND (l.expires_at IS NULL OR l.expires_at > ?))';",
    "const historyBytesSql = 'SELECT typeof(u.discord_id) AS discord_id_type, hex(CAST(u.discord_id AS BLOB)) AS discord_id_hex, typeof(u.name) AS discord_name_type, hex(CAST(u.name AS BLOB)) AS discord_name_hex, typeof(u.active_x_user_id) AS active_x_user_id_type, hex(CAST(u.active_x_user_id AS BLOB)) AS active_x_user_id_hex, typeof(u.image) AS user_image_type, hex(CAST(u.image AS BLOB)) AS user_image_hex, typeof(x.x_name) AS x_name_type, hex(CAST(x.x_name AS BLOB)) AS x_name_hex, typeof(x.icon_url) AS x_icon_url_type, hex(CAST(x.icon_url AS BLOB)) AS x_icon_url_hex FROM u04a_user_history u LEFT JOIN u04a_x_users_history x ON x.id = u.active_x_user_id AND x.version = ? WHERE u.id = ? AND u.version = ?';",
    "const captureSql = 'INSERT INTO audit_actor_snapshots_u04a (id, discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url, user_version, x_version) SELECT ?, u.discord_id, u.name, u.active_x_user_id, u.image, x.x_name, x.icon_url, u.actor_snapshot_version, COALESCE(x.actor_snapshot_version, -1) FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ? AND u.actor_snapshot_version = ? AND COALESCE(x.actor_snapshot_version, -1) = ?';",
    "const sourceBytesSql = 'SELECT typeof(u.discord_id) AS discord_id_type, hex(CAST(u.discord_id AS BLOB)) AS discord_id_hex, typeof(u.name) AS discord_name_type, hex(CAST(u.name AS BLOB)) AS discord_name_hex, typeof(u.active_x_user_id) AS active_x_user_id_type, hex(CAST(u.active_x_user_id AS BLOB)) AS active_x_user_id_hex, typeof(u.image) AS user_image_type, hex(CAST(u.image AS BLOB)) AS user_image_hex, typeof(x.x_name) AS x_name_type, hex(CAST(x.x_name AS BLOB)) AS x_name_hex, typeof(x.icon_url) AS x_icon_url_type, hex(CAST(x.icon_url AS BLOB)) AS x_icon_url_hex FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const snapshotBytesSql = 'SELECT typeof(discord_id) AS discord_id_type, hex(CAST(discord_id AS BLOB)) AS discord_id_hex, typeof(discord_name) AS discord_name_type, hex(CAST(discord_name AS BLOB)) AS discord_name_hex, typeof(active_x_user_id) AS active_x_user_id_type, hex(CAST(active_x_user_id AS BLOB)) AS active_x_user_id_hex, typeof(user_image) AS user_image_type, hex(CAST(user_image AS BLOB)) AS user_image_hex, typeof(x_name) AS x_name_type, hex(CAST(x_name AS BLOB)) AS x_name_hex, typeof(x_icon_url) AS x_icon_url_type, hex(CAST(x_icon_url AS BLOB)) AS x_icon_url_hex FROM audit_actor_snapshots_u04a WHERE id = ?';",
    "async function run(db, sql, params = []) { const statement = db.prepare(sql); const bound = params.length ? statement.bind(...params) : statement; const r = await bound.run(); if (r.success !== true) throw new Error('D1 run failed'); return Number(r.meta?.changes ?? 0); }",
    "async function runMeta(db, sql, params = []) { const statement = db.prepare(sql); const bound = params.length ? statement.bind(...params) : statement; const r = await bound.run(); if (r.success !== true) throw new Error('D1 metric run failed'); return r.meta ?? {}; }",
    "async function all(db, sql, params = []) { const statement = db.prepare(sql); const bound = params.length ? statement.bind(...params) : statement; const r = await bound.all(); if (r.success !== true || !Array.isArray(r.results)) throw new Error('D1 all failed'); return r.results; }",
    "async function probeBackfill(db) {",
    "  // Disposable tables only: seed legacy rows before installing history triggers.",
    "  await run(db, 'CREATE TABLE u04f_seq (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL CHECK(typeof(n)=\\'integer\\' AND n BETWEEN 0 AND 9007199254740991))');",
    "  await run(db, 'INSERT INTO u04f_seq VALUES (1,0)');",
    "  const shapes = [",
    "    { table: 'u04f_user', fields: ['id','discord_id','name','active_x_user_id','image'], definition: 'id TEXT PRIMARY KEY, discord_id TEXT, name TEXT, active_x_user_id TEXT, image TEXT' },",
    "    { table: 'u04f_x', fields: ['id','x_name','icon_url'], definition: 'id TEXT PRIMARY KEY, x_name TEXT NOT NULL, icon_url TEXT' },",
    "  ];",
    "  for (const {table,fields,definition} of shapes) {",
    "    await run(db, 'CREATE TABLE '+table+' ('+definition+', actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "    await run(db, 'CREATE TABLE '+table+'_history (version INTEGER PRIMARY KEY,'+fields.join(',')+')');",
    "  }",
    "  await run(db, \"INSERT INTO u04f_x (id,x_name,icon_url) VALUES ('legacy',CAST(X'FF8000C3' AS TEXT),X'FF8000C3'),('racing','before','icon'),('failed','retry','icon')\");",
    "  await run(db, \"INSERT INTO u04f_user (id,discord_id,name,active_x_user_id,image) VALUES ('legacy-user','d',CAST(X'EFBBBF610062' AS TEXT),'legacy',?),('deleted','old','old',NULL,NULL),('noop',NULL,'same',NULL,NULL)\", ['u'.repeat(100000)]);",
    "  for (const {table,fields} of shapes) {",
    "    const cols=fields.join(',');",
    "    const changed=fields.map(c=>'OLD.'+c+' IS NOT NEW.'+c).join(' OR ');",
    "    for (const [kind,event] of [['insert','INSERT'],['update','UPDATE OF '+cols]]) {",
    "      const when=kind==='update'?' WHEN '+changed:'';",
    "      await run(db, \"CREATE TRIGGER \"+table+\"_\"+kind+\" AFTER \"+event+\" ON \"+table+when+\" BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM u04f_seq WHERE id=1 AND typeof(n)='integer' AND n>=0 AND n<9007199254740991) THEN RAISE(ABORT,'ACTOR_VERSION_UNAVAILABLE') END; UPDATE u04f_seq SET n=n+1 WHERE id=1; UPDATE \"+table+\" SET actor_snapshot_version=(SELECT n FROM u04f_seq WHERE id=1) WHERE id=NEW.id; INSERT INTO \"+table+\"_history (version,\"+cols+\") SELECT actor_snapshot_version,\"+cols+\" FROM \"+table+\" WHERE id=NEW.id; END\");",
    "    }",
    "  }",
    "  await run(db, 'CREATE TABLE u04f_failure (v INTEGER CHECK(v=1))');",
    "  const seq=async()=>Number((await all(db,'SELECT n FROM u04f_seq WHERE id=1'))[0].n);",
    "  const version=async(table,id)=>Number((await all(db,'SELECT actor_snapshot_version AS v FROM '+table+' WHERE id=?',[id]))[0].v);",
    "  const count=async(table)=>Number((await all(db,'SELECT COUNT(*) AS n FROM '+table+'_history'))[0].n);",
    "  const snapshot=async(table,id)=> {",
    "    const shape=shapes.find(x=>x.table===table);",
    "    const cols=shape.fields.join(',');",
    "    const raw=shape.fields.flatMap(c=>['typeof('+c+') AS '+c+'_type','hex(CAST('+c+' AS BLOB)) AS '+c+'_hex']).join(',');",
    "    const v=await version(table,id);",
    "    const live=(await all(db,'SELECT '+cols+','+raw+' FROM '+table+' WHERE id=?',[id]))[0];",
    "    const history=(await all(db,'SELECT '+cols+','+raw+' FROM '+table+'_history WHERE version=?',[v]))[0];",
    "    return {v,match:JSON.stringify(live)===JSON.stringify(history),history};",
    "  };",
    "  async function backfill(table,id,fail=false) {",
    "    const cols=shapes.find(x=>x.table===table).fields.join(',');",
    "    // One ID-bound batch; all three operations share the same pending-row predicate.",
    "    // A concurrent normal writer that already allocated a version makes this a no-op.",
    "    const pending='id=? AND actor_snapshot_version=0';",
    "    const statements=[",
    "      db.prepare('UPDATE u04f_seq SET n=n+1 WHERE id=1 AND EXISTS(SELECT 1 FROM '+table+' WHERE '+pending+')').bind(id),",
    "      db.prepare('INSERT INTO '+table+'_history (version,'+cols+') SELECT (SELECT n FROM u04f_seq WHERE id=1),'+cols+' FROM '+table+' WHERE '+pending).bind(id),",
    "      db.prepare('UPDATE '+table+' SET actor_snapshot_version=(SELECT n FROM u04f_seq WHERE id=1) WHERE '+pending).bind(id),",
    "    ];",
    "    if(fail)statements.push(db.prepare('INSERT INTO u04f_failure(v) VALUES (2)'));",
    "    try {",
    "      const results=await db.batch(statements);",
    "      return results.every(r=>r.success===true);",
    "    } catch { return false; }",
    "  }",
    "  const initialZero=(await seq())===0 && (await count('u04f_user'))===0 && (await count('u04f_x'))===0;",
    "  await run(db,\"UPDATE u04f_x SET x_name='changed' WHERE id='racing'\");",
    "  await run(db,\"UPDATE u04f_user SET name=name WHERE id='noop'\");",
    "  await run(db,\"DELETE FROM u04f_user WHERE id='deleted'\");",
    "  await run(db,\"INSERT INTO u04f_user (id,discord_id,name) VALUES ('deleted','new','new')\");",
    "  const writerVersions=[await version('u04f_x','racing'),await version('u04f_user','deleted')];",
    "  const prefilled=writerVersions.every(v=>v>0) && (await version('u04f_user','noop'))===0 && (await seq())===2;",
    "  const first=await backfill('u04f_x','legacy');",
    "  const old=await snapshot('u04f_x','legacy');",
    "  const beforeReplay=await seq();",
    "  const replay=(await backfill('u04f_x','legacy'))&&(await backfill('u04f_x','racing'))&&(await backfill('u04f_user','deleted'));",
    "  const replayStable=(await seq())===beforeReplay && (await version('u04f_x','racing'))===writerVersions[0] && (await version('u04f_user','deleted'))===writerVersions[1];",
    "  const beforeFailure={seq:await seq(),count:await count('u04f_x')};",
    "  const failed=!(await backfill('u04f_x','failed',true));",
    "  const rollback=failed && (await seq())===beforeFailure.seq && (await count('u04f_x'))===beforeFailure.count && (await version('u04f_x','failed'))===0;",
    "  const retry=await backfill('u04f_x','failed');",
    "  const user=await backfill('u04f_user','legacy-user');",
    "  const beforeConcurrent=await seq();",
    "  const concurrent=await Promise.all([backfill('u04f_user','noop'),backfill('u04f_user','noop')]);",
    "  const concurrentOnce=concurrent.every(Boolean) && (await seq())===beforeConcurrent+1;",
    "  const current=[];",
    "  for(const [table,ids] of [['u04f_user',['legacy-user','deleted','noop']],['u04f_x',['legacy','racing','failed']]]) {",
    "    for(const id of ids)current.push(await snapshot(table,id));",
    "  }",
    "  const versionsDistinct=current.every(x=>x.v>0) && new Set(current.map(x=>x.v)).size===6;",
    "  const rawAndDecoded=current.every(x=>x.match);",
    "  const rawLegacy=old.history.x_name_type==='text' && old.history.x_name_hex==='FF8000C3' && old.history.icon_url_type==='blob' && old.history.icon_url_hex==='FF8000C3';",
    "  const userLegacy=current[0].history.name_hex==='EFBBBF610062' && current[0].history.image_hex.length===200000;",
    "  await run(db,\"UPDATE u04f_x SET x_name='after-backfill', icon_url='new' WHERE id='legacy'\");",
    "  const oldRow=(await all(db,'SELECT typeof(x_name) AS name_type,hex(CAST(x_name AS BLOB)) AS name_hex,typeof(icon_url) AS icon_type,hex(CAST(icon_url AS BLOB)) AS icon_hex FROM u04f_x_history WHERE version=?',[old.v]))[0];",
    "  const retained=oldRow?.name_type==='text'&&oldRow?.name_hex==='FF8000C3'&&oldRow?.icon_type==='blob'&&oldRow?.icon_hex==='FF8000C3'&&(await version('u04f_x','legacy'))>old.v&&(await snapshot('u04f_x','legacy')).match;",
    "  return {initialZero,prefilled,first,replay,replayStable,rollback,retry,user,concurrentOnce,versionsDistinct,rawAndDecoded,rawLegacy,userLegacy,retained,sequence:await seq(),historyRows:(await count('u04f_user'))+(await count('u04f_x')),productionRowsScanned:0};",
    "}",
    "async function probePendingBackfill(db) {",
    "  // A separate disposable actor table with the baseline's ordinary rowid/TEXT PK shape.",
    "  // Keep the target identity entirely in SQL; never bind a decoded legacy ID or a JS Number rowid.",
    "  await run(db, 'CREATE TABLE u04g_actor (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, 'CREATE TABLE u04g_history (version INTEGER PRIMARY KEY, id TEXT, label TEXT, image TEXT)');",
    "  await run(db, \"CREATE TABLE u04g_seq (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL CHECK(typeof(n)='integer' AND n BETWEEN 0 AND 9007199254740991))\");",
    "  await run(db, 'INSERT INTO u04g_seq VALUES(1,0)');",
    "  await run(db, 'CREATE TABLE u04g_failure (v INTEGER CHECK(v=1))');",
    "  await run(db, 'CREATE INDEX u04g_pending_actor ON u04g_actor(actor_snapshot_version) WHERE actor_snapshot_version=0');",
    "  await run(db, \"INSERT INTO u04g_actor(rowid,id,label,image) VALUES(-9223372036854775808,'','empty',CAST(X'FF8000C3' AS TEXT)),(-3,'A','text-A',CAST(X'FF8000C3' AS TEXT)),(-1,X'41','blob-A',CAST(X'FF8000C3' AS TEXT)),(0,CAST(X'FF' AS TEXT),'malformed',CAST(X'FF8000C3' AS TEXT)),(1,CAST(X'EFBFBD' AS TEXT),'replacement',CAST(X'FF8000C3' AS TEXT)),(9007199254740993,CAST(X'610062' AS TEXT),'NUL',CAST(X'FF8000C3' AS TEXT)),(9223372036854775806,CAST(X'EFBBBF61' AS TEXT),'BOM',CAST(X'FF8000C3' AS TEXT)),(9223372036854775807,?,'large',CAST(X'FF8000C3' AS TEXT))\", ['L'.repeat(100000)]);",
    "  const pick='SELECT rowid FROM u04g_actor WHERE actor_snapshot_version=0 ORDER BY rowid LIMIT 1';",
    "  const pending='rowid=('+pick+') AND actor_snapshot_version=0';",
    "  const statements=[",
    "    'UPDATE u04g_seq SET n=n+1 WHERE id=1 AND EXISTS(SELECT 1 FROM u04g_actor WHERE actor_snapshot_version=0)',",
    "    'INSERT INTO u04g_history(version,id,label,image) SELECT (SELECT n FROM u04g_seq WHERE id=1),id,label,image FROM u04g_actor WHERE '+pending,",
    "    'UPDATE u04g_actor SET actor_snapshot_version=(SELECT n FROM u04g_seq WHERE id=1) WHERE '+pending,",
    "  ];",
    "  const plans=await Promise.all([pick,...statements].map(sql=>all(db,'EXPLAIN QUERY PLAN '+sql)));",
    "  const indexed=plans.every(plan=>plan.some(r=>String(r.detail).includes('u04g_pending_actor')) && !plan.some(r=>String(r.detail).includes('TEMP B-TREE')));",
    "  const locators=(await all(db,'SELECT CAST(rowid AS TEXT) AS locator FROM u04g_actor WHERE actor_snapshot_version=0 ORDER BY rowid LIMIT 8')).map(r=>r.locator);",
    "  const exactLocators=locators.join(',')==='-9223372036854775808,-3,-1,0,1,9007199254740993,9223372036854775806,9223372036854775807' && locators.every(v=>typeof v==='string'&&v.length<=20);",
    "  const count=async(table)=>Number((await all(db,'SELECT COUNT(*) AS n FROM '+table))[0].n);",
    "  const sequence=async()=>Number((await all(db,'SELECT n FROM u04g_seq WHERE id=1'))[0].n);",
    "  const pendingCount=async()=>Number((await all(db,'SELECT COUNT(*) AS n FROM u04g_actor WHERE actor_snapshot_version=0'))[0].n);",
    "  async function backfill(lateFailure=false) {",
    "    const batch=statements.map(sql=>db.prepare(sql));",
    "    if(lateFailure)batch.push(db.prepare('INSERT INTO u04g_failure VALUES(2)'));",
    "    const results=await db.batch(batch);",
    "    if(!results.every(r=>r.success===true))throw new Error('pending backfill failed');",
    "    return results.map(r=>({changes:Number(r.meta?.changes??-1),rowsRead:Number(r.meta?.rows_read??-1),rowsWritten:Number(r.meta?.rows_written??-1)}));",
    "  }",
    "  const rejects=async(lateFailure=false)=>{try{await backfill(lateFailure);return false;}catch{return true;}};",
    "  const lateRollback=await rejects(true) && (await sequence())===0 && (await count('u04g_history'))===0 && (await pendingCount())===8;",
    "  await run(db,'DELETE FROM u04g_seq');",
    "  const missingRollback=await rejects() && (await count('u04g_history'))===0 && (await pendingCount())===8;",
    "  await run(db,'INSERT INTO u04g_seq VALUES(1,9007199254740991)');",
    "  const exhaustedRollback=await rejects() && (await sequence())===9007199254740991 && (await count('u04g_history'))===0 && (await pendingCount())===8;",
    "  await run(db,'UPDATE u04g_seq SET n=0');",
    "  // Simulate locator movement before the next transaction. No externally selected cursor is retained.",
    "  await run(db,\"UPDATE u04g_actor SET rowid=-10 WHERE label='empty'\");",
    "  const results=await Promise.all(Array.from({length:8},()=>backfill()));",
    "  const oneEach=results.every(batch=>batch.length===3&&batch.every(r=>r.changes===1));",
    "  const receiptMetadata=results.every(batch=>batch.every(r=>Number.isFinite(r.rowsRead)&&r.rowsRead>=0&&Number.isFinite(r.rowsWritten)&&r.rowsWritten>=0));",
    "  const rawMatch=Number((await all(db,\"SELECT COUNT(*) AS n FROM u04g_actor a JOIN u04g_history h ON h.version=a.actor_snapshot_version WHERE a.label=h.label AND typeof(a.id)=typeof(h.id) AND hex(CAST(a.id AS BLOB))=hex(CAST(h.id AS BLOB)) AND typeof(a.image)=typeof(h.image) AND hex(CAST(a.image AS BLOB))=hex(CAST(h.image AS BLOB))\"))[0].n);",
    "  const distinct=Number((await all(db,'SELECT COUNT(DISTINCT actor_snapshot_version) AS n FROM u04g_actor WHERE actor_snapshot_version>0'))[0].n);",
    "  const replay=[await backfill(),await backfill()];",
    "  const replayNoop=replay.every(batch=>batch.length===3&&batch.every(r=>r.changes===0));",
    "  return {indexed,exactLocators,lateRollback,missingRollback,exhaustedRollback,oneEach,receiptMetadata,rawMatch,distinct,replayNoop,sequence:await sequence(),pending:await pendingCount(),historyRows:await count('u04g_history'),batchMetrics:results,productionRowsScanned:0};",
    "}",
    "async function probePendingBackfillScale(db) {",
    "  // Synthetic-only index construction and bounded resume; no production actor scan.",
    "  const metric = meta => ({ rowsRead: Number(meta?.rows_read ?? -1), rowsWritten: Number(meta?.rows_written ?? -1),",
    "    durationMs: Number(meta?.duration ?? -1), sizeAfter: Number(meta?.size_after ?? -1) });",
    "  const validMeta = m => Object.values(m).every(n => Number.isFinite(n) && n >= 0)",
    "    && Number.isSafeInteger(m.rowsRead) && Number.isSafeInteger(m.rowsWritten) && Number.isSafeInteger(m.sizeAfter);",
    "  const cases = [];",
    "  for (const [population, initialPending] of [[16,4],[256,4],[4096,4],[4096,4096]]) {",
    "    const suffix = population + '_' + initialPending;",
    "    const actor = 'u04h_actor_' + suffix, history = 'u04h_history_' + suffix, seq = 'u04h_seq_' + suffix, index = 'u04h_pending_' + suffix;",
    "    await run(db, 'CREATE TABLE ' + actor + ' (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "    await run(db, 'CREATE TABLE ' + history + ' (version INTEGER PRIMARY KEY, id TEXT, label TEXT, image TEXT)');",
    "    await run(db, \"CREATE TABLE \" + seq + \" (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL CHECK(typeof(n)='integer' AND n BETWEEN 0 AND 9007199254740991))\");",
    "    await run(db, 'INSERT INTO ' + seq + ' VALUES(1,?)', [population-initialPending]);",
    "    // Pending rows are deliberately last by rowid in the sparse cases.",
    "    await run(db, \"WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<?) INSERT INTO \" + actor +",
    "      \" (rowid,id,label,image,actor_snapshot_version) SELECT v,'actor-'||v,'label-'||v,CAST(X'FF8000C3' AS TEXT),CASE WHEN v>? THEN 0 ELSE v END FROM n\", [population,population-initialPending]);",
    "    const pick = 'SELECT rowid FROM ' + actor + ' WHERE actor_snapshot_version=0 ORDER BY rowid LIMIT 1';",
    "    const pending = 'rowid=(' + pick + ') AND actor_snapshot_version=0';",
    "    const statements = [",
    "      'UPDATE ' + seq + ' SET n=n+1 WHERE id=1 AND EXISTS(SELECT 1 FROM ' + actor + ' WHERE actor_snapshot_version=0)',",
    "      'INSERT INTO ' + history + '(version,id,label,image) SELECT (SELECT n FROM ' + seq + ' WHERE id=1),id,label,image FROM ' + actor + ' WHERE ' + pending,",
    "      'UPDATE ' + actor + ' SET actor_snapshot_version=(SELECT n FROM ' + seq + ' WHERE id=1) WHERE ' + pending,",
    "    ];",
    "    const probePick = async () => {",
    "      const r = await db.prepare(pick).all();",
    "      if (!r.success || r.results.length !== 1 || r.results[0].rowid !== population-initialPending+1) throw Error('synthetic first pending locator mismatch');",
    "      return metric(r.meta);",
    "    };",
    "    const beforePlan = await all(db, 'EXPLAIN QUERY PLAN ' + pick);",
    "    const before = await probePick();",
    "    const indexBuild = metric(await runMeta(db, 'CREATE INDEX ' + index + ' ON ' + actor + '(actor_snapshot_version) WHERE actor_snapshot_version=0'));",
    "    const after = await probePick();",
    "    const plans = await Promise.all([pick,...statements].map(sql=>all(db,'EXPLAIN QUERY PLAN '+sql)));",
    "    const indexed = plans.every(plan=>plan.some(r=>String(r.detail).includes(index)) && !plan.some(r=>String(r.detail).includes('TEMP B-TREE')));",
    "    const noIndexScan = beforePlan.some(r=>String(r.detail).includes('SCAN '+actor));",
    "    async function bounded(limit) {",
    "      const batches = [];",
    "      for(let i=0;i<limit;i++){",
    "        const result = await db.batch(statements.map(sql=>db.prepare(sql)));",
    "        if(result.length!==3 || !result.every(r=>r.success===true))throw Error('partial backfill batch');",
    "        const receipts = result.map(r=>({changes:Number(r.meta?.changes??-1),...metric(r.meta)}));",
    "        if(!receipts.every(validMetaForBatch))throw Error('missing or invalid D1 backfill metadata');",
    "        const changes = receipts.map(r=>r.changes).join(',');",
    "        if(changes!=='0,0,0' && changes!=='1,1,1')throw Error('inconsistent backfill changes');",
    "        batches.push(receipts);",
    "        if(changes==='0,0,0')return {processed:i,attempted:i+1,stop:'EMPTY_OBSERVED',batches};",
    "      }",
    "      return {processed:limit,attempted:limit,stop:'BUDGET_STOP',batches};",
    "    }",
    "    function validMetaForBatch({changes,...meta}) { return Number.isSafeInteger(changes)&&changes>=0&&validMeta(meta); }",
    "    const first = await bounded(2), resumed = await bounded(3);",
    "    // Full counts are allowed only in these fixed, disposable fixtures, not in an operational runner.",
    "    const count = async sql => Number((await all(db,sql))[0].n);",
    "    const remaining = await count('SELECT COUNT(*) AS n FROM '+actor+' WHERE actor_snapshot_version=0');",
    "    const historyRows = await count('SELECT COUNT(*) AS n FROM '+history);",
    "    const rawMatches = await count('SELECT COUNT(*) AS n FROM '+history+' h JOIN '+actor+\" a ON a.actor_snapshot_version=h.version WHERE h.id=a.id AND h.label=a.label AND typeof(h.image)=typeof(a.image) AND hex(CAST(h.image AS BLOB))=hex(CAST(a.image AS BLOB))\");",
    "    const sequence = await count('SELECT n FROM '+seq+' WHERE id=1');",
    "    const allBatches = [...first.batches,...resumed.batches];",
    "    const maxRead = Math.max(...allBatches.map(batch=>batch.reduce((sum,r)=>sum+r.rowsRead,0)));",
    "    const maxWritten = Math.max(...allBatches.map(batch=>batch.reduce((sum,r)=>sum+r.rowsWritten,0)));",
    "    cases.push({population,initialPending,noIndexScan,indexed,metadataAvailable:[before,indexBuild,after].every(validMeta),",
    "      before,indexBuild,after,first,resumed,remaining,historyRows,rawMatches,sequence,maxRead,maxWritten});",
    "  }",
    "  return {cases,productionRowsScanned:0};",
    "}",
    "async function probeRevisionIntegrity(db) {",
    "  // Disposable fixture: intentionally allow direct pointer writes to characterize",
    "  // invalid references before any production schema or write policy is adopted.",
    "  await run(db, \"CREATE TABLE u04j_actor(id TEXT PRIMARY KEY NOT NULL, x_name TEXT, icon_url TEXT, actor_snapshot_version INTEGER NOT NULL)\");",
    "  await run(db, \"CREATE TABLE u04j_history(version INTEGER PRIMARY KEY, id, x_name, icon_url)\");",
    "  await run(db, \"INSERT INTO u04j_actor VALUES ('a','current',NULL,2)\");",
    "  await run(db, \"INSERT INTO u04j_history VALUES (0,'a','current',NULL),(1,'a','old',NULL),(2,'a','current',NULL),(3,'b','current',NULL),(4,'a',CAST('current' AS BLOB),NULL),(5,'a','current',''),(6,'a','current',NULL),(7,'a',CAST(X'FF8000C3' AS TEXT),NULL),(8,'a',CAST(X'EFBFBDEFBFBD00EFBFBD' AS TEXT),NULL),(9,'a',X'FF8000C3',NULL)\");",
    "  // Compare identity, storage class and exact raw bytes inside SQL, not provider-decoded strings.",
    "  const rawEquality = ['id','x_name','icon_url'].map(k => 'typeof(h.'+k+')=typeof(a.'+k+') AND CAST(h.'+k+' AS BLOB) IS CAST(a.'+k+' AS BLOB)').join(' AND ');",
    "  const receiptSql = \"SELECT CASE WHEN typeof(a.actor_snapshot_version)='integer' AND a.actor_snapshot_version BETWEEN 1 AND 9007199254740991 AND EXISTS(SELECT 1 FROM u04j_history h WHERE h.version=a.actor_snapshot_version AND \" + rawEquality + \") THEN 1 ELSE 0 END AS ok FROM u04j_actor a WHERE a.id=?\";",
    "  const checks = [];",
    "  const check = async (label, version) => {",
    "    await run(db, 'UPDATE u04j_actor SET actor_snapshot_version=? WHERE id=?', [version,'a']);",
    "    const rows = await all(db, receiptSql, ['a']);",
    "    if (rows.length !== 1 || ![0,1].includes(rows[0].ok)) throw new Error('invalid revision receipt');",
    "    checks.push([label, rows[0].ok]);",
    "  };",
    "  for (const [label, version] of [['current',2],['cross-actor',3],['stale-different',1],['missing',999],['zero',0],['fractional',2.5],['same-bytes-blob',4],['empty-v-null',5],['same-content-other-version',6]]) {",
    "    await check(label, version);",
    "  }",
    "  await run(db, \"UPDATE u04j_actor SET x_name=CAST(X'FF8000C3' AS TEXT) WHERE id='a'\");",
    "  for (const [label, version] of [['raw-malformed-exact',7],['replacement-different',8],['raw-blob-v-text',9]]) {",
    "    await check(label, version);",
    "  }",
    "  // A same-content different incarnation cannot be distinguished by this receipt alone.",
    "  // Generic write/restore paths must still prohibit external version assignment.",
    "  return {checks,missingActor:(await all(db, receiptSql, ['missing'])).length===0,productionRowsScanned:0};",
    "}",
    "async function probe(db) {",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_user (id TEXT PRIMARY KEY, discord_id TEXT, name TEXT, active_x_user_id TEXT, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_x_users (id TEXT PRIMARY KEY, x_name TEXT NOT NULL, icon_url TEXT, approval_status TEXT NOT NULL DEFAULT \\'pending\\', actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  // Test-only monotonic allocation: row incarnation must survive DELETE/reinsert, REPLACE and PK changes.",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_actor_sequence (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL CHECK (typeof(n) = \\'integer\\' AND n BETWEEN 0 AND 9007199254740991))');",
    "  await run(db, 'INSERT OR IGNORE INTO u04a_actor_sequence VALUES (1, 0)');",
    "  for (const [table, fields] of [['u04a_user', 'id, discord_id, name, active_x_user_id, image'], ['u04a_x_users', 'id, x_name, icon_url']]) {",
    "    const isUser = table === 'u04a_user';",
    "    const historyTable = table + '_history';",
    "    const historyColumns = isUser ? 'version INTEGER PRIMARY KEY, id, discord_id, name, active_x_user_id, image' : 'version INTEGER PRIMARY KEY, id, x_name, icon_url';",
    "    const historyInsertColumns = isUser ? 'version, id, discord_id, name, active_x_user_id, image' : 'version, id, x_name, icon_url';",
    "    const historySelectColumns = isUser ? 'actor_snapshot_version, id, discord_id, name, active_x_user_id, image' : 'actor_snapshot_version, id, x_name, icon_url';",
    "    await run(db, 'CREATE TABLE IF NOT EXISTS ' + historyTable + ' (' + historyColumns + ')');",
    "    const changed = isUser ? 'OLD.id IS NOT NEW.id OR OLD.discord_id IS NOT NEW.discord_id OR OLD.name IS NOT NEW.name OR OLD.active_x_user_id IS NOT NEW.active_x_user_id OR OLD.image IS NOT NEW.image' : 'OLD.id IS NOT NEW.id OR OLD.x_name IS NOT NEW.x_name OR OLD.icon_url IS NOT NEW.icon_url';",
    "    for (const [kind, event] of [['insert', 'INSERT'], ['update', 'UPDATE OF ' + fields]]) {",
    "      const when = kind === 'update' ? ' WHEN ' + changed : '';",
    "      await run(db, 'CREATE TRIGGER IF NOT EXISTS ' + table + '_' + kind + ' AFTER ' + event + ' ON ' + table + when + ' BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM u04a_actor_sequence WHERE id = 1 AND typeof(n) = \\'integer\\' AND n >= 0 AND n < 9007199254740991) THEN RAISE(ABORT, \\'ACTOR_VERSION_UNAVAILABLE\\') END; UPDATE u04a_actor_sequence SET n = n + 1 WHERE id = 1; UPDATE ' + table + ' SET actor_snapshot_version = (SELECT n FROM u04a_actor_sequence WHERE id = 1) WHERE id = NEW.id; INSERT INTO ' + historyTable + ' (' + historyInsertColumns + ') SELECT ' + historySelectColumns + ' FROM ' + table + ' WHERE id = NEW.id; END');",
    "    }",
    "  }",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04e_user_baseline (id TEXT PRIMARY KEY, discord_id TEXT, name TEXT, active_x_user_id TEXT, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, \"CREATE TABLE IF NOT EXISTS u04e_x_users_baseline (id TEXT PRIMARY KEY, x_name TEXT NOT NULL, icon_url TEXT, approval_status TEXT NOT NULL DEFAULT 'pending', actor_snapshot_version INTEGER NOT NULL DEFAULT 0)\");",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_resource (id TEXT PRIMARY KEY, value TEXT NOT NULL)');",
    "  await run(db, \"INSERT OR IGNORE INTO u04a_resource VALUES ('target', 'before')\");",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_snapshots_u04a (id TEXT PRIMARY KEY, discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url, user_version INTEGER NOT NULL, x_version INTEGER NOT NULL)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_refs_u04a (audit_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES audit_actor_snapshots_u04a(id))');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_audit_inline (id TEXT PRIMARY KEY, actor_snapshot_json TEXT NOT NULL)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_actor_history_refs (id TEXT PRIMARY KEY, user_version INTEGER NOT NULL, x_version INTEGER NOT NULL)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_actor_history_refs_fk (id TEXT PRIMARY KEY, user_version INTEGER NOT NULL REFERENCES u04a_user_history(version), x_version INTEGER NOT NULL REFERENCES u04a_x_users_history(version))');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_actor_history_leases (id TEXT PRIMARY KEY, user_version INTEGER NOT NULL, x_version INTEGER NOT NULL, expires_at INTEGER)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_forced_failure (value INTEGER NOT NULL CHECK (value = 1))');",
    "  await run(db, 'INSERT OR IGNORE INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES (?, ?, ?, ?, ?)', ['admin-1', 'd', 'Name', 'u04a-x', 'image']);",
    "  await run(db, 'INSERT OR IGNORE INTO u04a_x_users (id, x_name, icon_url) VALUES (?, ?, ?)', ['u04a-x', 'X name', 'https://i/x.png']);",
    "  const updateUser = (values) => run(db, 'UPDATE u04a_user SET discord_id = ?, name = ?, active_x_user_id = ?, image = ? WHERE id = ?', [...values, 'admin-1']);",
    "  const updateX = (values) => run(db, 'UPDATE u04a_x_users SET x_name = ?, icon_url = ? WHERE id = ?', [...values, 'u04a-x']);",
    "  const getVersions = async () => (await all(db, versionsSql, ['admin-1']))[0];",
    "  const invalidUtf8 = new Uint8Array([255, 128, 0, 195]);",
    "  const nul = String.fromCharCode(0);",
    "  const cases = [",
    "    { label: 'null-no-active-x', user: [null, null, null, null], x: ['X name', null] },",
    "    { label: 'empty-shadowed-fallback', user: ['', '', 'u04a-x', 'user-image'], x: ['', ''] },",
    "    { label: 'unicode', user: ['雪🙂', '名前🙂', 'u04a-x', '画像'], x: ['X雪', 'https://i/雪.png'] },",
    "    { label: 'embedded-nul', user: ['d' + nul + 'id', 'n' + nul + 'ame', 'u04a-x', 'img' + nul + 'tail'], x: ['x' + nul + 'name', 'icon' + nul + 'tail'] },",
    "    { label: 'invalid-utf8-blob', user: [invalidUtf8, invalidUtf8, 'u04a-x', invalidUtf8], x: [invalidUtf8, invalidUtf8] },",
    "    { label: 'nontext-active-x', user: ['d', 'n', invalidUtf8, 'image'], x: ['X name', 'https://i/x.png'] },",
    "    { label: 'large-legacy-value', user: ['d', 'n', 'u04a-x', 'u'.repeat(100000)], x: ['x', null] },",
    "    { label: 'malformed-text', user: ['d', 'n', 'u04a-x', 'image'], x: ['x', 'icon'] },",
    "    { label: 'bom-and-multibyte', user: ['\\uFEFF雪', '🙂', 'u04a-x', '画像'], x: ['\\uFEFFX', ''] },",
    "  ];",
    "  const casesOut = [];",
    "  for (let i = 0; i < cases.length; i++) {",
    "    const item = cases[i];",
    "    await updateUser(item.user); await updateX(item.x);",
    "    if (item.label === 'malformed-text') {",
    "      await run(db, \"UPDATE u04a_user SET discord_id = CAST(X'FF8000C3' AS TEXT), name = CAST(X'EFBBBF61' AS TEXT) WHERE id = 'admin-1'\");",
    "      await run(db, \"UPDATE u04a_x_users SET x_name = CAST(X'FF8000C3' AS TEXT) WHERE id = 'u04a-x'\");",
    "    }",
    "    const source = (await all(db, sourceSql, ['admin-1']))[0];",
    "    const versions = await getVersions();",
    "    const id = 'case-' + i;",
    "    const inserted = await run(db, captureSql, [id, 'admin-1', versions.user_version, versions.x_version]);",
    "    if (inserted !== 1) throw new Error('snapshot capture failed: ' + item.label);",
    "    const snapshot = (await all(db, 'SELECT discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url FROM audit_actor_snapshots_u04a WHERE id = ?', [id]))[0];",
    "    const sourceJson = JSON.stringify(actorSnapshotFromRow(source));",
    "    const snapshotJson = JSON.stringify(actorSnapshotFromRow(snapshot));",
    "    const sourceBytes = (await all(db, sourceBytesSql, ['admin-1']))[0];",
    "    const snapshotBytes = (await all(db, snapshotBytesSql, [id]))[0];",
    "    const history = (await all(db, historySql, [versions.x_version, 'admin-1', versions.user_version]))[0];",
    "    const historyJsonMatch = JSON.stringify(actorSnapshotFromRow(history)) === sourceJson;",
    "    const historyBytes = (await all(db, historyBytesSql, [versions.x_version, 'admin-1', versions.user_version]))[0];",
    "    const historyBytesMatch = JSON.stringify(historyBytes) === JSON.stringify(sourceBytes);",
    "    casesOut.push({ label: item.label, sourceJson, snapshotJson, sourceBytes, snapshotBytes, historyJsonMatch, historyBytesMatch, iconUrl: actorSnapshotFromRow(snapshot).icon_url });",
    "    await run(db, 'DELETE FROM audit_actor_snapshots_u04a WHERE id = ?', [id]);",
    "  }",
    "  const blobCase = casesOut.find(x => x.label === 'invalid-utf8-blob');",
    "  // Compare JSON1 with the SAME BLOB fixture, not the last item in the preceding loop.",
    "  const blobFixture = cases.find(x => x.label === 'invalid-utf8-blob');",
    "  await updateUser(blobFixture.user); await updateX(blobFixture.x);",
    "  const blobJson1FixtureMatches = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0])) === blobCase.sourceJson;",
    "  let json1 = null, json1Error = null;",
    "  try {",
    "    const rows = await all(db, \"SELECT json_object('discord_id', u.discord_id, 'discord_name', u.name, 'x_user_id', u.active_x_user_id, 'x_name', x.x_name, 'icon_url', COALESCE(NULLIF(x.icon_url, ''), u.image)) AS json FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?\", ['admin-1']);",
    "    json1 = rows[0]?.json ?? null;",
    "  } catch (error) { json1Error = String(error?.message ?? error); }",
    "  await updateUser(['before', 'Before', 'u04a-x', 'https://i/before.png']); await updateX(['X before', 'https://i/before.png']);",
    "  const stale = await getVersions();",
    "  await updateX(['X after', 'https://i/after.png']);",
    "  const staleChanges = await run(db, captureSql, ['stale', 'admin-1', stale.user_version, stale.x_version]);",
    "  const staleCount = Number((await all(db, \"SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id = 'stale'\"))[0].n);",
    "  const current = await getVersions();",
    "  let rollbackFailed = false;",
    "  try {",
    "    const results = await db.batch([",
    "      db.prepare(captureSql).bind('rolled-back', 'admin-1', current.user_version, current.x_version),",
    "      db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (?)').bind(2),",
    "    ]);",
    "    rollbackFailed = Array.isArray(results) && results.some(result => result.success !== true);",
    "  } catch { rollbackFailed = true; }",
    "  const rollbackCount = Number((await all(db, \"SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id = 'rolled-back'\"))[0].n);",
    "  const abandonedCount = Number((await all(db, \"SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id = 'abandoned'\"))[0].n);",
    "  const successVersions = await getVersions();",
    "  await db.batch([",
    "    db.prepare(captureSql).bind('kept', 'admin-1', successVersions.user_version, successVersions.x_version),",
    "    db.prepare('INSERT INTO audit_actor_refs_u04a (audit_id, snapshot_id) VALUES (?, ?)').bind('audit-u04a', 'kept'),",
    "  ]);",
    "  const successRef = (await all(db, \"SELECT snapshot_id FROM audit_actor_refs_u04a WHERE audit_id = 'audit-u04a'\"))[0]?.snapshot_id ?? null;",
    "  // Admission token is small; capture and assert its freshness before any resource/audit mutation.",
    "  async function resetActor() {",
    "    await run(db, \"INSERT OR REPLACE INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES ('admin-1', 'd', 'Before', 'u04a-x', 'user-image')\");",
    "    await run(db, \"INSERT OR REPLACE INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x', 'X before', 'x-icon')\");",
    "    await run(db, \"UPDATE u04a_resource SET value = 'before' WHERE id = 'target'\");",
    "  }",
    "  const userInsert = \"INSERT INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES ('admin-1','d','After','u04a-x','user-image')\";",
    "  const xInsert = \"INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x','X after','x-icon')\";",
    "  const casesFence = [",
    "    ['authjs-user-delete-reinsert', [\"DELETE FROM u04a_user WHERE id='admin-1'\", userInsert]],",
    "    ['xid-admin-delete-reinsert', [\"DELETE FROM u04a_x_users WHERE id='u04a-x'\", xInsert]],",
    "    ['authjs-user-replace', [userInsert.replace('INSERT INTO', 'INSERT OR REPLACE INTO')]],",
    "    ['xid-admin-replace', [xInsert.replace('INSERT INTO', 'INSERT OR REPLACE INTO')]],",
    "    ['user-pk-aba', [\"UPDATE u04a_user SET id='temp-user' WHERE id='admin-1'\", \"UPDATE u04a_user SET id='admin-1' WHERE id='temp-user'\"]],",
    "    ['x-pk-aba', [\"UPDATE u04a_x_users SET id='temp-x' WHERE id='u04a-x'\", \"UPDATE u04a_x_users SET id='u04a-x' WHERE id='temp-x'\"]],",
    "    ['authjs-user-name-update', [\"UPDATE u04a_user SET name='After' WHERE id='admin-1'\"]],",
    "    ['authjs-user-discord-id-update', [\"UPDATE u04a_user SET discord_id='d-after' WHERE id='admin-1'\"]],",
    "    ['authjs-user-image-update', [\"UPDATE u04a_user SET image='image-after' WHERE id='admin-1'\"]],",
    "    ['xid-profile-name-update', [\"UPDATE u04a_x_users SET x_name='X after' WHERE id='u04a-x'\"]],",
    "    ['xid-icon-update', [\"UPDATE u04a_x_users SET icon_url='https://i/xid-after.png' WHERE id='u04a-x'\"]],",
    "    ['spreadsheet-x-name-update', [\"UPDATE u04a_x_users SET x_name='X spreadsheet' WHERE id='u04a-x'\"]],",
    "    ['spreadsheet-x-icon-update', [\"UPDATE u04a_x_users SET icon_url='https://i/spreadsheet.png' WHERE id='u04a-x'\"]],",
    "    ['user-delete', [\"DELETE FROM u04a_user WHERE id='admin-1'\"]],",
    "    ['x-delete', [\"DELETE FROM u04a_x_users WHERE id='u04a-x'\"]],",
    "    ['active-x-clear', [\"UPDATE u04a_user SET active_x_user_id=NULL WHERE id='admin-1'\"]],",
    "    ['active-x-reassign', [\"UPDATE u04a_user SET active_x_user_id='u04a-x2' WHERE id='admin-1'\"], \"INSERT OR REPLACE INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x2', 'X two', 'https://i/x2.png')\"],",
    "    ['spreadsheet-x-insert', [xInsert], \"DELETE FROM u04a_x_users WHERE id='u04a-x'\"],",
    "    ['bulk-replace-video-members-noop', [\"INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x', 'X ignored', 'https://i/ignored.png') ON CONFLICT(id) DO UPDATE SET id=excluded.id\"], null, false],",
    "    ['bulk-video-collab-perms-noop', [\"INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x', 'X ignored', 'https://i/ignored.png') ON CONFLICT(id) DO UPDATE SET id=excluded.id\"], null, false],",
    "    ['approval-status-only', [\"UPDATE u04a_x_users SET approval_status='approved' WHERE id='u04a-x'\"], null, false],",
    "  ];",
    "  const fencedBatch = (id, versions, tail = []) => [",
    "    db.prepare(captureSql).bind(id, 'admin-1', versions.user_version, versions.x_version),",
    "    db.prepare('INSERT INTO u04a_forced_failure(value) SELECT changes()'),",
    "    db.prepare('DELETE FROM u04a_forced_failure'),",
    "    db.prepare(\"UPDATE u04a_resource SET value='after' WHERE id='target'\"),",
    "    ...tail,",
    "    db.prepare('INSERT INTO audit_actor_refs_u04a (audit_id, snapshot_id) VALUES (?, ?)').bind(id, id),",
    "  ];",
    "  async function batchFailed(statements) {",
    "    try { const results = await db.batch(statements); return Array.isArray(results) && results.some(result => result.success !== true); }",
    "    catch { return true; }",
    "  }",
    "  const getResource = async () => (await all(db, \"SELECT value FROM u04a_resource WHERE id='target'\"))[0].value;",
    "  const getSeq = async () => (await all(db, 'SELECT n FROM u04a_actor_sequence WHERE id=1'))[0].n;",
    "  const countSnapshot = async (id) => Number((await all(db, 'SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id=?', [id]))[0].n);",
    "  const countRef = async (id) => Number((await all(db, 'SELECT COUNT(*) AS n FROM audit_actor_refs_u04a WHERE audit_id=?', [id]))[0].n);",
    "  const fenceOut = [];",
    "  for (const [label, changes, beforeAdmission, expectedVersionChange = true] of casesFence) {",
    "    await resetActor();",
    "    if (beforeAdmission) await run(db, beforeAdmission);",
    "    const admitted = await getVersions();",
    "    for (const sql of changes) await run(db, sql);",
    "    const after = await getVersions();",
    "    const versionChanged = !after || admitted.user_version !== after.user_version || admitted.x_version !== after.x_version;",
    "    const failed = await batchFailed(fencedBatch('fence-' + label, admitted));",
    "    const liveX = (await all(db, \"SELECT x_name, icon_url, approval_status FROM u04a_x_users WHERE id='u04a-x'\"))[0] ?? null;",
    "    fenceOut.push({ label, versionChanged, expectedVersionChange, failed, snapshotCount: await countSnapshot('fence-' + label), refCount: await countRef('fence-' + label), resource: await getResource(), liveX });",
    "  }",
    "  await resetActor();",
    "  const positiveVersions = await getVersions();",
    "  const positiveResults = await db.batch(fencedBatch('fence-success', positiveVersions, [db.prepare(\"UPDATE u04a_x_users SET x_name='X after' WHERE id='u04a-x'\")]));",
    "  const positive = { allSuccess: positiveResults.every(r => r.success === true), snapshotName: (await all(db, \"SELECT x_name FROM audit_actor_snapshots_u04a WHERE id='fence-success'\"))[0]?.x_name, liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name, resource: await getResource(), refCount: await countRef('fence-success') };",
    "  // CURRENT keeps the admission-time actor JSON across a concurrent actor update before the final batch.",
    "  await resetActor();",
    "  const interleavingAdmissionRow = (await all(db, sourceSql, ['admin-1']))[0];",
    "  const interleavingAdmissionJson = JSON.stringify(actorSnapshotFromRow(interleavingAdmissionRow));",
    "  await updateX(['X concurrent', 'https://i/concurrent.png']);",
    "  const interleavingLiveJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  const interleavingResults = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('current-success', 'target'),",
    "    db.prepare('INSERT INTO u04a_audit_inline (id, actor_snapshot_json) VALUES (?, ?)').bind('current-success', interleavingAdmissionJson),",
    "  ]);",
    "  const interleavingStored = (await all(db, 'SELECT actor_snapshot_json FROM u04a_audit_inline WHERE id=?', ['current-success']))[0]?.actor_snapshot_json ?? null;",
    "  const interleaving = { allSuccess: interleavingResults.every(r => r.success === true), admissionJson: interleavingAdmissionJson, storedJson: interleavingStored, liveJson: interleavingLiveJson, resource: await getResource() };",
    "  await resetActor();",
    "  const interleavingFenceVersions = await getVersions();",
    "  await updateX(['X concurrent', 'https://i/concurrent.png']);",
    "  const interleavingFenceFailed = await batchFailed(fencedBatch('interleave-fenced', interleavingFenceVersions));",
    "  const interleavingFence = { failed: interleavingFenceFailed, snapshotCount: await countSnapshot('interleave-fenced'), refCount: await countRef('interleave-fenced'), resource: await getResource(), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  await resetActor();",
    "  const interleavingFailureRow = (await all(db, sourceSql, ['admin-1']))[0];",
    "  const interleavingFailureJson = JSON.stringify(actorSnapshotFromRow(interleavingFailureRow));",
    "  await updateX(['X concurrent', 'https://i/concurrent.png']);",
    "  const interleavingCurrentFailure = await batchFailed([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('current-failed', 'target'),",
    "    db.prepare('INSERT INTO u04a_audit_inline (id, actor_snapshot_json) VALUES (?, ?)').bind('current-failed', interleavingFailureJson),",
    "    db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (?)').bind(2),",
    "  ]);",
    "  const interleavingFailure = { failed: interleavingCurrentFailure, auditCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_audit_inline WHERE id=?', ['current-failed']))[0].n), resource: await getResource(), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  await resetActor();",
    "  const interleavingFailureFenceVersions = await getVersions();",
    "  await updateX(['X concurrent', 'https://i/concurrent.png']);",
    "  const interleavingFailureFenceFailed = await batchFailed(fencedBatch('interleave-failed-fence', interleavingFailureFenceVersions));",
    "  const interleavingFailureFence = { failed: interleavingFailureFenceFailed, snapshotCount: await countSnapshot('interleave-failed-fence'), refCount: await countRef('interleave-failed-fence'), resource: await getResource(), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  await resetActor();",
    "  const immutableHistoryVersions = await getVersions();",
    "  const immutableHistoryAdmissionJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  await updateX(['X history concurrent', 'https://i/history-concurrent.png']);",
    "  const immutableHistoryLiveJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  const immutableHistoryResults = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('history-success', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) VALUES (?, ?, ?)').bind('history-success', immutableHistoryVersions.user_version, immutableHistoryVersions.x_version),",
    "  ]);",
    "  const immutableHistoryRow = (await all(db, historySql, [immutableHistoryVersions.x_version, 'admin-1', immutableHistoryVersions.user_version]))[0];",
    "  const immutableHistoryJson = JSON.stringify(actorSnapshotFromRow(immutableHistoryRow));",
    "  const immutableHistory = { allSuccess: immutableHistoryResults.every(r => r.success === true), admissionJson: immutableHistoryAdmissionJson, historyJson: immutableHistoryJson, liveJson: immutableHistoryLiveJson, resource: await getResource(), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['history-success']))[0].n), userHistoryCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_user_history WHERE version=?', [immutableHistoryVersions.user_version]))[0].n), xHistoryCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_x_users_history WHERE version=?', [immutableHistoryVersions.x_version]))[0].n) };",
    "  await resetActor();",
    "  const immutableHistoryFailureVersions = await getVersions();",
    "  const immutableHistoryFailureAdmissionJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  await run(db, \"DELETE FROM u04a_x_users WHERE id='u04a-x'\");",
    "  await run(db, \"INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x', 'X history reinserted', 'https://i/reinserted.png')\");",
    "  const immutableHistoryFailureFailed = await batchFailed([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('history-failed', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) VALUES (?, ?, ?)').bind('history-failed', immutableHistoryFailureVersions.user_version, immutableHistoryFailureVersions.x_version),",
    "    db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (?)').bind(2),",
    "  ]);",
    "  const immutableHistoryFailureRow = (await all(db, historySql, [immutableHistoryFailureVersions.x_version, 'admin-1', immutableHistoryFailureVersions.user_version]))[0];",
    "  const immutableHistoryFailureOut = { failed: immutableHistoryFailureFailed, refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['history-failed']))[0].n), resource: await getResource(), historyAvailable: !!immutableHistoryFailureRow, admissionJson: immutableHistoryFailureAdmissionJson, historyJson: JSON.stringify(actorSnapshotFromRow(immutableHistoryFailureRow)), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  await resetActor();",
    "  const immutableHistoryLifecycleVersions = await getVersions();",
    "  const immutableHistoryLifecycleSource = (await all(db, sourceSql, ['admin-1']))[0];",
    "  const immutableHistoryLifecycleAdmissionJson = JSON.stringify(actorSnapshotFromRow(immutableHistoryLifecycleSource));",
    "  const immutableHistoryLifecycleAdmissionBytes = (await all(db, sourceBytesSql, ['admin-1']))[0];",
    "  await run(db, \"DELETE FROM u04a_user WHERE id='admin-1'\");",
    "  await run(db, \"INSERT INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES ('admin-1', 'd-after', 'User after lifecycle', 'u04a-x', 'image-after')\");",
    "  await run(db, \"DELETE FROM u04a_x_users WHERE id='u04a-x'\");",
    "  await run(db, \"INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ('u04a-x', 'X after lifecycle', 'https://i/after.png')\");",
    "  const immutableHistoryLifecycleLiveJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  const immutableHistoryLifecycleResults = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('history-lifecycle', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) VALUES (?, ?, ?)').bind('history-lifecycle', immutableHistoryLifecycleVersions.user_version, immutableHistoryLifecycleVersions.x_version),",
    "  ]);",
    "  const immutableHistoryLifecycleRow = (await all(db, historySql, [immutableHistoryLifecycleVersions.x_version, 'admin-1', immutableHistoryLifecycleVersions.user_version]))[0];",
    "  const immutableHistoryLifecycleBytes = (await all(db, historyBytesSql, [immutableHistoryLifecycleVersions.x_version, 'admin-1', immutableHistoryLifecycleVersions.user_version]))[0];",
    "  const immutableHistoryLifecycle = { allSuccess: immutableHistoryLifecycleResults.every(r => r.success === true), admissionJson: immutableHistoryLifecycleAdmissionJson, historyJson: JSON.stringify(actorSnapshotFromRow(immutableHistoryLifecycleRow)), liveJson: immutableHistoryLifecycleLiveJson, historyBytesMatch: JSON.stringify(immutableHistoryLifecycleBytes) === JSON.stringify(immutableHistoryLifecycleAdmissionBytes), resource: await getResource(), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['history-lifecycle']))[0].n), userHistoryCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_user_history WHERE version=?', [immutableHistoryLifecycleVersions.user_version]))[0].n), xHistoryCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_x_users_history WHERE version=?', [immutableHistoryLifecycleVersions.x_version]))[0].n) };",
    "  await resetActor();",
    "  const cleanupNoFkVersions = await getVersions();",
    "  await run(db, 'DELETE FROM u04a_user_history WHERE version=?', [cleanupNoFkVersions.user_version]);",
    "  await run(db, 'DELETE FROM u04a_x_users_history WHERE version=?', [cleanupNoFkVersions.x_version]);",
    "  const cleanupNoFkResults = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('cleanup-no-fk', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) VALUES (?, ?, ?)').bind('cleanup-no-fk', cleanupNoFkVersions.user_version, cleanupNoFkVersions.x_version),",
    "  ]);",
    "  const cleanupNoFkRow = (await all(db, historySql, [cleanupNoFkVersions.x_version, 'admin-1', cleanupNoFkVersions.user_version]))[0] ?? null;",
    "  const cleanupNoFk = { allSuccess: cleanupNoFkResults.every(r => r.success === true), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['cleanup-no-fk']))[0].n), historyAvailable: !!cleanupNoFkRow, resource: await getResource() };",
    "  await resetActor();",
    "  const cleanupFkVersions = await getVersions();",
    "  await run(db, 'DELETE FROM u04a_user_history WHERE version=?', [cleanupFkVersions.user_version]);",
    "  await run(db, 'DELETE FROM u04a_x_users_history WHERE version=?', [cleanupFkVersions.x_version]);",
    "  const cleanupFkFailed = await batchFailed([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('cleanup-fk', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs_fk (id, user_version, x_version) VALUES (?, ?, ?)').bind('cleanup-fk', cleanupFkVersions.user_version, cleanupFkVersions.x_version),",
    "  ]);",
    "  const cleanupFk = { failed: cleanupFkFailed, refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs_fk WHERE id=?', ['cleanup-fk']))[0].n), resource: await getResource() };",
    "  await resetActor();",
    "  const readerImage = '🙂'.repeat(20000);",
    "  await run(db, 'UPDATE u04a_user SET image = ? WHERE id = ?', [readerImage, 'admin-1']);",
    "  await run(db, \"UPDATE u04a_x_users SET icon_url=NULL WHERE id='u04a-x'\");",
    "  const readerVersions = await getVersions();",
    "  const readerAdmissionJson = JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0]));",
    "  const readerBatch = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('reader-success', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) VALUES (?, ?, ?)').bind('reader-1', readerVersions.user_version, readerVersions.x_version),",
    "  ]);",
    "  await updateUser(['d-live', 'Live name', 'u04a-x', 'live-image']);",
    "  await updateX(['X live', 'https://i/live.png']);",
    "  const readerHistoryRow = (await all(db, historyByRefSql, ['reader-1']))[0];",
    "  const readerHistoryJson = JSON.stringify(actorSnapshotFromRow(readerHistoryRow));",
    "  const readerListRow = (await all(db, historyListSql, ['reader-1']))[0];",
    "  const readerListResponseBytes = new TextEncoder().encode(JSON.stringify({ rows: [readerListRow], operators: [] })).byteLength;",
    "  const readerSnapshotBytes = new TextEncoder().encode(readerHistoryJson).byteLength;",
    "  const readerCodePoints = Array.from(readerHistoryJson);",
    "  const readerChunks = [];",
    "  for (let offset = 0; offset < readerCodePoints.length; offset += 12000) {",
    "    const chunk = readerCodePoints.slice(offset, offset + 12000).join('');",
    "    readerChunks.push({ offset, total: readerCodePoints.length, chunk, nextOffset: offset + 12000 < readerCodePoints.length ? offset + 12000 : null });",
    "  }",
    "  const readerChunkBytes = readerChunks.map(item => new TextEncoder().encode(item.chunk).byteLength);",
    "  const readerChunkOffsetsValid = readerChunks.every((item, i) => {",
    "    const expectedNextOffset = (i + 1) * 12000 < readerCodePoints.length ? (i + 1) * 12000 : null;",
    "    return item.offset === i * 12000 && item.total === readerCodePoints.length && item.nextOffset === expectedNextOffset;",
    "  });",
    "  const reader = { allSuccess: readerBatch.every(r => r.success === true), admissionJson: readerAdmissionJson, historyJson: readerHistoryJson, liveJson: JSON.stringify(actorSnapshotFromRow((await all(db, sourceSql, ['admin-1']))[0])), listRow: readerListRow, listResponseBytes: readerListResponseBytes, snapshotBytes: readerSnapshotBytes, chunkCount: readerChunks.length, maxChunkBytes: Math.max(...readerChunkBytes), chunkOffsetsValid: readerChunkOffsetsValid, reassembledJson: readerChunks.map(item => item.chunk).join('') };",
    "  await resetActor();",
    "  // Lease acquisition captures the current actor versions and persists their reservation in one INSERT ... SELECT statement.",
    "  await resetActor();",
    "  const leaseCurrentVersions = await getVersions();",
    "  const leaseCurrentCleanup = await db.batch([",
    "    db.prepare(cleanupUserHistorySql).bind(leaseCurrentVersions.user_version, 100),",
    "    db.prepare(cleanupXHistorySql).bind(leaseCurrentVersions.x_version, 100),",
    "  ]);",
    "  const leaseAcquireResults = await db.batch([db.prepare(leaseAcquireSql).bind('lease-success', 'admin-1')]);",
    "  const leaseRow = (await all(db, 'SELECT user_version, x_version, expires_at FROM u04a_actor_history_leases WHERE id=?', ['lease-success']))[0];",
    "  const leaseAdmissionRow = (await all(db, historySql, [leaseRow.x_version, 'admin-1', leaseRow.user_version]))[0];",
    "  const leaseAdmissionJson = JSON.stringify(actorSnapshotFromRow(leaseAdmissionRow));",
    "  await updateUser(['d-after-lease', 'User after lease', 'u04a-x', 'user-after-lease']);",
    "  await updateX(['X after lease', 'https://i/after-lease.png']);",
    "  const leaseCleanupWhileActive = await db.batch([",
    "    db.prepare(cleanupUserHistorySql).bind(leaseRow.user_version, 100),",
    "    db.prepare(cleanupXHistorySql).bind(leaseRow.x_version, 100),",
    "  ]);",
    "  const leaseHistoryWhileActive = (await all(db, historySql, [leaseRow.x_version, 'admin-1', leaseRow.user_version]))[0] ?? null;",
    "  const leaseFailedFinalize = await batchFailed([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('lease-failed', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) SELECT ?, user_version, x_version FROM u04a_actor_history_leases WHERE id=?').bind('lease-success', 'lease-success'),",
    "    db.prepare('DELETE FROM u04a_actor_history_leases WHERE id=?').bind('lease-success'),",
    "    db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (?)').bind(2),",
    "  ]);",
    "  const leaseAfterFailedFinalize = { leaseCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_leases WHERE id=?', ['lease-success']))[0].n), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['lease-success']))[0].n), resource: await getResource(), historyAvailable: !!(await all(db, historySql, [leaseRow.x_version, 'admin-1', leaseRow.user_version]))[0] };",
    "  const leaseFinalizeResults = await db.batch([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('lease-success', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) SELECT ?, user_version, x_version FROM u04a_actor_history_leases WHERE id=?').bind('lease-success', 'lease-success'),",
    "    db.prepare('DELETE FROM u04a_actor_history_leases WHERE id=?').bind('lease-success'),",
    "  ]);",
    "  const leaseCleanupAfterFinalize = await db.batch([",
    "    db.prepare(cleanupUserHistorySql).bind(leaseRow.user_version, 100),",
    "    db.prepare(cleanupXHistorySql).bind(leaseRow.x_version, 100),",
    "  ]);",
    "  const leaseHistoryAfterFinalize = (await all(db, historySql, [leaseRow.x_version, 'admin-1', leaseRow.user_version]))[0] ?? null;",
    "  const leaseLifecycle = { currentCleanupChanges: leaseCurrentCleanup.map(r => Number(r.meta?.changes ?? 0)), acquireSuccess: leaseAcquireResults.every(r => r.success === true), acquiredVersionsMatch: Number(leaseRow.user_version) === Number(leaseCurrentVersions.user_version) && Number(leaseRow.x_version) === Number(leaseCurrentVersions.x_version), expiresAt: leaseRow.expires_at, admissionJson: leaseAdmissionJson, activeCleanupChanges: leaseCleanupWhileActive.map(r => Number(r.meta?.changes ?? 0)), historyWhileActive: !!leaseHistoryWhileActive, failedFinalize: leaseFailedFinalize, afterFailedFinalize: leaseAfterFailedFinalize, finalizeSuccess: leaseFinalizeResults.every(r => r.success === true), postFinalizeCleanupChanges: leaseCleanupAfterFinalize.map(r => Number(r.meta?.changes ?? 0)), historyAfterFinalizeJson: leaseHistoryAfterFinalize ? JSON.stringify(actorSnapshotFromRow(leaseHistoryAfterFinalize)) : null, leaseCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_leases WHERE id=?', ['lease-success']))[0].n), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['lease-success']))[0].n), resource: await getResource() };",
    "  await resetActor();",
    "  const orphanAcquire = await db.batch([db.prepare(leaseAcquireSql).bind('lease-orphan', 'admin-1')]);",
    "  const orphanLease = (await all(db, 'SELECT user_version, x_version, expires_at FROM u04a_actor_history_leases WHERE id=?', ['lease-orphan']))[0];",
    "  await updateUser(['d-orphan', 'User after orphan', 'u04a-x', 'user-orphan']);",
    "  await updateX(['X after orphan', 'https://i/orphan.png']);",
    "  const orphanCleanup = await db.batch([",
    "    db.prepare(cleanupUserHistorySql).bind(orphanLease.user_version, 100),",
    "    db.prepare(cleanupXHistorySql).bind(orphanLease.x_version, 100),",
    "  ]);",
    "  const leaseOrphan = { acquireSuccess: orphanAcquire.every(r => r.success === true), expiresAt: orphanLease.expires_at, cleanupChanges: orphanCleanup.map(r => Number(r.meta?.changes ?? 0)), leaseCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_leases WHERE id=?', ['lease-orphan']))[0].n), refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['lease-orphan']))[0].n), historyAvailable: !!(await all(db, historySql, [orphanLease.x_version, 'admin-1', orphanLease.user_version]))[0] };",
    "  await resetActor();",
    "  const expiryAcquire = await db.batch([db.prepare(leaseAcquireExpiringSql).bind('lease-expired', 'admin-1')]);",
    "  const expiredLease = (await all(db, 'SELECT user_version, x_version, expires_at FROM u04a_actor_history_leases WHERE id=?', ['lease-expired']))[0];",
    "  await updateUser(['d-expired', 'User after expired lease', 'u04a-x', 'user-expired']);",
    "  await updateX(['X after expired lease', 'https://i/expired.png']);",
    "  const expiryCleanup = await db.batch([",
    "    db.prepare('DELETE FROM u04a_actor_history_leases WHERE expires_at IS NOT NULL AND expires_at <= ?').bind(100),",
    "    db.prepare(cleanupUserHistorySql).bind(expiredLease.user_version, 100),",
    "    db.prepare(cleanupXHistorySql).bind(expiredLease.x_version, 100),",
    "  ]);",
    "  const expiryFinalizeFailed = await batchFailed([",
    "    db.prepare('UPDATE u04a_resource SET value=? WHERE id=?').bind('expired-lease-finalize', 'target'),",
    "    db.prepare('INSERT INTO u04a_actor_history_refs (id, user_version, x_version) SELECT ?, user_version, x_version FROM u04a_actor_history_leases WHERE id=?').bind('lease-expired', 'lease-expired'),",
    "    db.prepare('INSERT INTO u04a_forced_failure(value) SELECT CASE WHEN changes() = 0 THEN 0 ELSE 1 END'),",
    "  ]);",
    "  const leaseExpiry = { acquireSuccess: expiryAcquire.every(r => r.success === true), expiresAt: expiredLease.expires_at, cleanupChanges: expiryCleanup.map(r => Number(r.meta?.changes ?? 0)), leaseCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_leases WHERE id=?', ['lease-expired']))[0].n), historyAvailable: !!(await all(db, historySql, [expiredLease.x_version, 'admin-1', expiredLease.user_version]))[0], finalizeFailed: expiryFinalizeFailed, refCount: Number((await all(db, 'SELECT COUNT(*) AS n FROM u04a_actor_history_refs WHERE id=?', ['lease-expired']))[0].n), resource: await getResource() };",
    "  await resetActor();",
    "  await resetActor();",
    "  await resetActor();",
    "  const beforeRollback = await getVersions();",
    "  const seqBefore = await getSeq();",
    "  const rollbackStatements = fencedBatch('fence-rollback', beforeRollback, [db.prepare(\"UPDATE u04a_x_users SET x_name='X after' WHERE id='u04a-x'\")]);",
    "  rollbackStatements.push(db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (2)'));",
    "  const lateFailed = await batchFailed(rollbackStatements);",
    "  const lateRollback = { failed: lateFailed, snapshotCount: await countSnapshot('fence-rollback'), refCount: await countRef('fence-rollback'), resource: await getResource(), beforeVersions: beforeRollback, afterVersions: await getVersions(), seqBefore, seqAfter: await getSeq(), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  // U04e: compare local D1 metadata with and without the test-only history triggers.",
    "  const metricMeta = meta => ({ rowsWritten: Number(meta?.rows_written ?? -1), rowsRead: Number(meta?.rows_read ?? -1), durationMs: Number(meta?.duration ?? -1), sizeAfter: Number(meta?.size_after ?? -1) });",
    "  const largeImage = 'u'.repeat(100000);",
    "  const largeIcon = '🙂'.repeat(10000);",
    "  const baselineUserMeta = await runMeta(db, 'INSERT INTO u04e_user_baseline (id, discord_id, name, active_x_user_id, image) VALUES (?, ?, ?, ?, ?)', ['u04e-single-user', 'd', 'Baseline', null, largeImage]);",
    "  const triggeredUserMeta = await runMeta(db, 'INSERT INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES (?, ?, ?, ?, ?)', ['u04e-single-user', 'd', 'Baseline', null, largeImage]);",
    "  const baselineXMeta = await runMeta(db, 'INSERT INTO u04e_x_users_baseline (id, x_name, icon_url) VALUES (?, ?, ?)', ['u04e-single-x', 'Baseline X', largeIcon]);",
    "  const triggeredXMeta = await runMeta(db, 'INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES (?, ?, ?)', ['u04e-single-x', 'Baseline X', largeIcon]);",
    "  const bulkRows = Array.from({ length: 8 }, (_, i) => ['u04e-bulk-' + i, 'X ' + i, 'icon-' + i]);",
    "  const bulkValues = bulkRows.map(() => '(?, ?, ?)').join(',');",
    "  const bulkParams = bulkRows.flat();",
    "  const baselineBulkMeta = await runMeta(db, 'INSERT INTO u04e_x_users_baseline (id, x_name, icon_url) VALUES ' + bulkValues, bulkParams);",
    "  const triggeredBulkMeta = await runMeta(db, 'INSERT INTO u04a_x_users (id, x_name, icon_url) VALUES ' + bulkValues, bulkParams);",
    "  const sequenceBeforeConcurrent = await getSeq();",
    "  const concurrentIds = Array.from({ length: 4 }, (_, i) => 'u04e-concurrent-' + i);",
    "  const concurrentMeta = await Promise.all(concurrentIds.map((id, i) => runMeta(db, 'INSERT INTO u04a_user (id, discord_id, name, active_x_user_id, image) VALUES (?, ?, ?, ?, ?)', [id, 'd-' + i, 'Concurrent ' + i, null, 'image-' + i])));",
    "  const sequenceAfterConcurrent = await getSeq();",
    "  const userPayloadBytes = Number((await all(db, 'SELECT COALESCE(SUM(COALESCE(length(CAST(id AS BLOB)),0) + COALESCE(length(CAST(discord_id AS BLOB)),0) + COALESCE(length(CAST(name AS BLOB)),0) + COALESCE(length(CAST(active_x_user_id AS BLOB)),0) + COALESCE(length(CAST(image AS BLOB)),0)),0) AS bytes FROM u04a_user_history WHERE id LIKE ?', ['u04e-%']))[0].bytes);",
    "  const xPayloadBytes = Number((await all(db, 'SELECT COALESCE(SUM(COALESCE(length(CAST(id AS BLOB)),0) + COALESCE(length(CAST(x_name AS BLOB)),0) + COALESCE(length(CAST(icon_url AS BLOB)),0)),0) AS bytes FROM u04a_x_users_history WHERE id LIKE ?', ['u04e-%']))[0].bytes);",
    "  const metricMetas = [baselineUserMeta, triggeredUserMeta, baselineXMeta, triggeredXMeta, baselineBulkMeta, triggeredBulkMeta, ...concurrentMeta];",
    "  const metrics = { metadataAvailable: metricMetas.every(meta => Number.isFinite(Number(meta?.rows_written)) && Number.isFinite(Number(meta?.duration))), single: { user: { baseline: metricMeta(baselineUserMeta), triggered: metricMeta(triggeredUserMeta) }, x: { baseline: metricMeta(baselineXMeta), triggered: metricMeta(triggeredXMeta) } }, bulkX: { count: bulkRows.length, baseline: metricMeta(baselineBulkMeta), triggered: metricMeta(triggeredBulkMeta) }, concurrent: { count: concurrentMeta.length, sequenceDelta: Number(sequenceAfterConcurrent) - Number(sequenceBeforeConcurrent), rowsWritten: concurrentMeta.reduce((sum, meta) => sum + Number(meta?.rows_written ?? 0), 0), maxDurationMs: Math.max(...concurrentMeta.map(meta => Number(meta?.duration ?? 0))) }, historyPayloadBytes: userPayloadBytes + xPayloadBytes, syntheticBackfill: { source: 'synthetic-fixture-only', productionRowsScanned: 0, largeImageBytes: new TextEncoder().encode(largeImage).length, largeIconBytes: new TextEncoder().encode(largeIcon).length, userPayloadBytes, xPayloadBytes } };",
    "  const backfill = await probeBackfill(db);",
    "  const pendingBackfill = await probePendingBackfill(db);",
    "  const pendingScale = await probePendingBackfillScale(db);",
    "  const revisionIntegrity = await probeRevisionIntegrity(db);",
    "  // Exhaustion is terminal for this disposable fixture. Explicit RAISE(ABORT)",
    "  // must not be weakened by an outer OR IGNORE or OR FAIL statement.",
    "  const allocatorOut = [];",
    "  const oldSequence = await getSeq();",
    "  const oldVersions = await getVersions();",
    "  await run(db, 'UPDATE u04a_actor_sequence SET n = 2.5 WHERE id=1').then(() => { throw new Error('fractional sequence accepted'); }, () => {});",
    "  const fractionalRejected = (await getSeq()) === oldSequence;",
    "  await run(db, \"UPDATE u04a_actor_sequence SET n = 9007199254740990 WHERE id=1\");",
    "  await run(db, \"UPDATE u04a_x_users SET x_name='at-max' WHERE id='u04a-x'\");",
    "  const maxToken = await getVersions();",
    "  const atMaxSeq = await getSeq();",
    "  for (const policy of ['', 'OR IGNORE', 'OR FAIL', 'OR ABORT', 'OR REPLACE', 'OR ROLLBACK']) {",
    "    const failed = await batchFailed([db.prepare('UPDATE ' + policy + \" u04a_x_users SET x_name='after-overflow' WHERE id='u04a-x'\")]);",
    "    allocatorOut.push({ policy, failed, versions: await getVersions(), seq: await getSeq(), name: (await all(db, sourceSql, ['admin-1']))[0]?.x_name });",
    "  }",
    "  const overflowBatchFailed = await batchFailed(fencedBatch('overflow-batch', maxToken, [db.prepare(\"UPDATE OR IGNORE u04a_x_users SET x_name='after-overflow' WHERE id='u04a-x'\")]));",
    "  const overflowBatch = { failed: overflowBatchFailed, snapshotCount: await countSnapshot('overflow-batch'), refCount: await countRef('overflow-batch'), resource: await getResource(), versions: await getVersions(), seq: await getSeq(), name: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
    "  await run(db, 'DELETE FROM u04a_actor_sequence WHERE id=1');",
    "  const missingFailed = await batchFailed([db.prepare(\"UPDATE OR IGNORE u04a_x_users SET x_name='after-missing' WHERE id='u04a-x'\")]);",
    "  const missing = { failed: missingFailed, versions: await getVersions(), name: (await all(db, sourceSql, ['admin-1']))[0]?.x_name, rows: (await all(db, 'SELECT n FROM u04a_actor_sequence')).length };",
    "  const allocator = { fractionalRejected, oldVersions, atMaxSeq, maxToken, allocatorOut, overflowBatch, missing };",
    "return { cases: casesOut, blobCanonicalJson: blobCase?.sourceJson ?? null, blobJson1FixtureMatches, json1, json1Error, staleChanges, staleCount, rollbackFailed, rollbackCount, abandonedCount, successRef, fenceOut, positive, interleaving, interleavingFence, interleavingFailure, interleavingFailureFence, immutableHistory, immutableHistoryFailureOut, immutableHistoryLifecycle, cleanupRace: { noFk: cleanupNoFk, fk: cleanupFk }, reader, leaseLifecycle, leaseOrphan, leaseExpiry, lateRollback, allocator, metrics, backfill, pendingBackfill, pendingScale, revisionIntegrity };",
    "}",
    "export default {",
    "  async fetch(request, env) {",
    "    const path = new URL(request.url).pathname;",
    "    if (path === '/health') return new Response('ok');",
    "    if (path === '/probe') {",
    "      try { return Response.json(await probe(env.DB)); }",
    "      catch (error) { return Response.json({ error: String(error?.stack ?? error?.message ?? error) }, { status: 500 }); }",
    "    }",
    "    return new Response('not found', { status: 404 });",
    "  },",
    "};",
  ].join("\n");

  fs.writeFileSync(workerPath, workerSource);
  fs.writeFileSync(configPath, [
    'name = "flamenode-u04a-actor-probe"',
    'main = "worker.mjs"',
    // Match the pinned API Wrangler template; do not use the calendar date of the test run.
    'compatibility_date = "2026-07-21"',
    'compatibility_flags = ["nodejs_compat"]',
    'workers_dev = false',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "u04a-actor-probe"',
    'database_id = "00000000-0000-0000-0000-000000000000"',
    "",
  ].join("\n"));

  let log = "";
  const child = spawn(process.execPath, [
    wranglerBin, "dev", "--local", "--config", configPath,
    "--persist-to", stateDir, "--port", String(port), "--ip", "127.0.0.1",
  ], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  child.stdout.on("data", chunk => { log += chunk.toString(); });
  child.stderr.on("data", chunk => { log += chunk.toString(); });

  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(base + "/health");
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, "wrangler dev did not start: " + log.slice(-2500));

    const response = await fetch(base + "/probe");
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.cases.length, 9);
    for (const item of body.cases) {
      assert.equal(item.sourceJson, item.snapshotJson, item.label + " workerd canonical JSON bytes");
      assert.deepEqual(item.sourceBytes, item.snapshotBytes, item.label + " workerd raw DB bytes/storage classes");
    assert.equal(item.historyJsonMatch, true, item.label);
    assert.equal(item.historyBytesMatch, true, item.label);
    }
    assert.equal(body.cases.find(x => x.label === "empty-shadowed-fallback").iconUrl, "user-image");
    assert.equal(body.blobJson1FixtureMatches, true);
    assert.ok(body.json1Error || body.json1 !== body.blobCanonicalJson, "SQL JSON1 unexpectedly matched invalid-UTF8/BLOB legacy JSON");
    const malformed = body.cases.find(x => x.label === "malformed-text");
    assert.equal(malformed.sourceBytes.discord_id_type, "text");
    assert.equal(malformed.sourceBytes.discord_id_hex, "FF8000C3");
    assert.equal(malformed.sourceBytes.x_name_type, "text");
    assert.equal(malformed.sourceBytes.x_name_hex, "FF8000C3");
    assert.equal(body.staleChanges, 0);
    assert.equal(body.staleCount, 0);
    assert.equal(body.rollbackFailed, true);
    assert.equal(body.rollbackCount, 0);
    assert.equal(body.abandonedCount, 0);
    assert.equal(body.successRef, "kept");
    assert.equal(body.fenceOut.length, 21);
    for (const item of body.fenceOut) {
      assert.equal(item.versionChanged, item.expectedVersionChange, item.label);
      assert.equal(item.failed, item.expectedVersionChange, item.label);
      assert.equal(item.snapshotCount, item.expectedVersionChange ? 0 : 1, item.label);
      assert.equal(item.refCount, item.expectedVersionChange ? 0 : 1, item.label);
      assert.equal(item.resource, item.expectedVersionChange ? "before" : "after", item.label);
    }
    assert.deepEqual(body.fenceOut.filter(item => !item.expectedVersionChange).map(item => item.label).sort(), ["approval-status-only", "bulk-replace-video-members-noop", "bulk-video-collab-perms-noop"].sort());
    for (const item of body.fenceOut.filter(item => !item.expectedVersionChange)) {
      assert.equal(item.liveX.x_name, "X before", item.label);
      assert.equal(item.liveX.icon_url, "x-icon", item.label);
    }
    assert.equal(body.fenceOut.find(item => item.label === "approval-status-only").liveX.approval_status, "approved");
    assert.deepEqual(body.positive, { allSuccess: true, snapshotName: "X before", liveName: "X after", resource: "after", refCount: 1 });
    assert.equal(body.interleaving.allSuccess, true);
    assert.equal(body.interleaving.storedJson, body.interleaving.admissionJson);
    assert.notEqual(body.interleaving.liveJson, body.interleaving.admissionJson);
    assert.equal(body.interleaving.resource, "current-success");
    assert.deepEqual(body.interleavingFence, {
      failed: true, snapshotCount: 0, refCount: 0, resource: "before", liveName: "X concurrent",
    });
    assert.deepEqual(body.interleavingFailure, {
      failed: true, auditCount: 0, resource: "before", liveName: "X concurrent",
    });
    assert.deepEqual(body.interleavingFailureFence, {
      failed: true, snapshotCount: 0, refCount: 0, resource: "before", liveName: "X concurrent",
    });
    assert.equal(body.immutableHistory.allSuccess, true);
    assert.equal(body.immutableHistory.historyJson, body.immutableHistory.admissionJson);
    assert.notEqual(body.immutableHistory.liveJson, body.immutableHistory.admissionJson);
    assert.equal(body.immutableHistory.resource, "history-success");
    assert.deepEqual({
      refCount: body.immutableHistory.refCount,
      userHistoryCount: body.immutableHistory.userHistoryCount,
      xHistoryCount: body.immutableHistory.xHistoryCount,
    }, { refCount: 1, userHistoryCount: 1, xHistoryCount: 1 });
    assert.deepEqual(body.immutableHistoryFailureOut, {
      failed: true,
      refCount: 0,
      resource: "before",
      historyAvailable: true,
      admissionJson: body.immutableHistoryFailureOut.admissionJson,
      historyJson: body.immutableHistoryFailureOut.admissionJson,
      liveName: "X history reinserted",
    });
    assert.equal(body.immutableHistoryLifecycle.allSuccess, true);
    assert.equal(body.immutableHistoryLifecycle.historyJson, body.immutableHistoryLifecycle.admissionJson);
    assert.notEqual(body.immutableHistoryLifecycle.liveJson, body.immutableHistoryLifecycle.admissionJson);
    assert.equal(body.immutableHistoryLifecycle.historyBytesMatch, true);
    assert.equal(body.immutableHistoryLifecycle.resource, "history-lifecycle");
    assert.deepEqual({ refCount: body.immutableHistoryLifecycle.refCount, userHistoryCount: body.immutableHistoryLifecycle.userHistoryCount, xHistoryCount: body.immutableHistoryLifecycle.xHistoryCount }, { refCount: 1, userHistoryCount: 1, xHistoryCount: 1 });
    assert.deepEqual(body.cleanupRace.noFk, { allSuccess: true, refCount: 1, historyAvailable: false, resource: "cleanup-no-fk" });
    assert.deepEqual(body.cleanupRace.fk, { failed: true, refCount: 0, resource: "before" });
    assert.equal(body.reader.allSuccess, true);
    assert.equal(body.reader.historyJson, body.reader.admissionJson);
    assert.notEqual(body.reader.liveJson, body.reader.admissionJson);
    assert.deepEqual(body.reader.listRow, { actor_ref_id: "reader-1", discord_name: "Before", x_user_id: "u04a-x", x_name: "X before" });
    assert.ok(body.reader.listResponseBytes <= 48 * 1024, "reference-only list projection must remain under the current 48 KiB list budget");
    assert.ok(body.reader.snapshotBytes > 48 * 1024, "full historical actor JSON fixture must exceed the list budget");
    assert.ok(body.reader.chunkCount > 1);
    assert.ok(body.reader.maxChunkBytes <= 48 * 1024, "each 12,000-code-point detail chunk must fit the 48 KiB payload budget");
    assert.equal(body.reader.chunkOffsetsValid, true);
    assert.equal(body.reader.reassembledJson, body.reader.admissionJson, "chunked detail must reassemble exact decoder-produced JSON without truncation");
    assert.deepEqual(body.leaseLifecycle.currentCleanupChanges, [0, 0], "cleanup must retain each currently active actor version");
    assert.equal(body.leaseLifecycle.acquireSuccess, true);
    assert.equal(body.leaseLifecycle.acquiredVersionsMatch, true, "lease INSERT ... SELECT must atomically capture the current version pair");
    assert.equal(body.leaseLifecycle.expiresAt, null, "no-expiry reservation is the only no-new-denial lease in this fixture");
    assert.deepEqual(body.leaseLifecycle.activeCleanupChanges, [0, 0], "active reservation must protect both historical rows");
    assert.equal(body.leaseLifecycle.historyWhileActive, true);
    assert.equal(body.leaseLifecycle.failedFinalize, true);
    assert.deepEqual(body.leaseLifecycle.afterFailedFinalize, { leaseCount: 1, refCount: 0, resource: "before", historyAvailable: true }, "failed final batch must roll back resource, ref and lease deletion together");
    assert.equal(body.leaseLifecycle.finalizeSuccess, true);
    assert.deepEqual(body.leaseLifecycle.postFinalizeCleanupChanges, [0, 0], "durable audit ref must protect history after the lease is consumed");
    assert.equal(body.leaseLifecycle.historyAfterFinalizeJson, body.leaseLifecycle.admissionJson);
    assert.deepEqual({ leaseCount: body.leaseLifecycle.leaseCount, refCount: body.leaseLifecycle.refCount, resource: body.leaseLifecycle.resource }, { leaseCount: 0, refCount: 1, resource: "lease-success" });
    assert.deepEqual(body.leaseOrphan, { acquireSuccess: true, expiresAt: null, cleanupChanges: [0, 0], leaseCount: 1, refCount: 0, historyAvailable: true }, "a crashed request without an enforced expiry safely retains history but leaves an orphan lease");
    assert.equal(body.leaseExpiry.acquireSuccess, true);
    assert.equal(body.leaseExpiry.expiresAt, 100);
    assert.deepEqual(body.leaseExpiry.cleanupChanges, [1, 1, 1], "expiry cleanup deletes the expired lease and unreferenced old versions");
    assert.equal(body.leaseExpiry.leaseCount, 0);
    assert.equal(body.leaseExpiry.historyAvailable, false);
    assert.equal(body.leaseExpiry.finalizeFailed, true, "an expired in-flight request is denied after cleanup unless the host enforces a hard lifetime bound");
    assert.equal(body.leaseExpiry.refCount, 0);
    assert.equal(body.leaseExpiry.resource, "before", "expired lease finalization must roll back the resource mutation");
    const late = body.lateRollback;
    assert.equal(late.failed, true);
    assert.equal(late.snapshotCount, 0);
    assert.equal(late.refCount, 0);
    assert.equal(late.resource, "before");
    assert.deepEqual(late.afterVersions, late.beforeVersions);
    assert.equal(late.seqAfter, late.seqBefore);
    assert.equal(late.liveName, "X before");
    const metrics = body.metrics;
    console.log('U04E_D1_METRICS ' + JSON.stringify(metrics));
    assert.equal(metrics.metadataAvailable, true, "Workerd D1 metadata must expose rows_written and duration");
    assert.ok(metrics.single.user.triggered.rowsWritten > metrics.single.user.baseline.rowsWritten, "user history trigger must add D1 row writes");
    assert.ok(metrics.single.x.triggered.rowsWritten > metrics.single.x.baseline.rowsWritten, "X history trigger must add D1 row writes");
    assert.ok(metrics.bulkX.triggered.rowsWritten > metrics.bulkX.baseline.rowsWritten, "bulk X history trigger must add D1 row writes");
    assert.equal(metrics.bulkX.count, 8);
    assert.equal(metrics.concurrent.count, 4);
    assert.equal(metrics.concurrent.sequenceDelta, 4, "concurrent actor inserts must serialize unique sequence allocations");
    assert.ok(metrics.concurrent.rowsWritten > 0);
    assert.ok(metrics.historyPayloadBytes >= metrics.syntheticBackfill.largeImageBytes + metrics.syntheticBackfill.largeIconBytes, "history payload byte estimate must include synthetic large legacy fields");
    assert.equal(metrics.syntheticBackfill.productionRowsScanned, 0);
    assert.equal(metrics.syntheticBackfill.source, "synthetic-fixture-only");
    const backfill = body.backfill;
    console.log('U04F_BACKFILL ' + JSON.stringify(backfill));
    assert.deepEqual(backfill, {
      initialZero: true, prefilled: true, first: true, replay: true, replayStable: true,
      rollback: true, retry: true, user: true, concurrentOnce: true, versionsDistinct: true,
      rawAndDecoded: true, rawLegacy: true, userLegacy: true, retained: true,
      sequence: 7, historyRows: 7, productionRowsScanned: 0,
    });
    const pendingBackfill = body.pendingBackfill;
    console.log('U04G_PENDING_BACKFILL ' + JSON.stringify(pendingBackfill));
    const { batchMetrics, ...pendingReceipt } = pendingBackfill;
    assert.deepEqual(pendingReceipt, {
      indexed: true, exactLocators: true, lateRollback: true, missingRollback: true,
      exhaustedRollback: true, oneEach: true, receiptMetadata: true, rawMatch: 8,
      distinct: 8, replayNoop: true, sequence: 8, pending: 0, historyRows: 8,
      productionRowsScanned: 0,
    });
    assert.equal(batchMetrics.length, 8);
    const pendingScale = body.pendingScale;
    console.log('U04H_PENDING_SCALE ' + JSON.stringify(pendingScale));
    assert.equal(pendingScale.productionRowsScanned, 0);
    assert.deepEqual(pendingScale.cases.map(c => [c.population,c.initialPending]), [[16,4],[256,4],[4096,4],[4096,4096]]);
    for (const c of pendingScale.cases) {
      assert.equal(c.noIndexScan, true);
      assert.equal(c.indexed, true);
      assert.equal(c.metadataAvailable, true);
      assert.equal(c.first.processed, 2);
      assert.equal(c.first.attempted, 2);
      assert.equal(c.first.stop, "BUDGET_STOP");
      const dense = c.initialPending === c.population;
      assert.equal(c.resumed.processed, dense ? 3 : 2);
      assert.equal(c.resumed.attempted, 3);
      assert.equal(c.resumed.stop, dense ? "BUDGET_STOP" : "EMPTY_OBSERVED");
      assert.equal(c.remaining, dense ? 4091 : 0);
      assert.equal(c.historyRows, dense ? 5 : 4);
      assert.equal(c.rawMatches, c.historyRows);
      assert.equal(c.sequence, c.population-c.initialPending+c.historyRows);
      assert.ok(c.after.rowsRead <= 2, "indexed single-row discovery must remain bounded");
      assert.ok(c.maxRead <= 16, "each atomic backfill transaction has a bounded local D1 rows_read envelope");
      assert.ok(c.maxWritten <= 3, "each atomic transaction has at most three logical D1 row writes");
    }
    const revisionIntegrity = body.revisionIntegrity;
    console.log('U04J_REVISION_INTEGRITY ' + JSON.stringify(revisionIntegrity));
    assert.deepEqual(revisionIntegrity, {
      checks: [
        ["current",1], ["cross-actor",0], ["stale-different",0],
        ["missing",0], ["zero",0], ["fractional",0], ["same-bytes-blob",0],
        ["empty-v-null",0], ["same-content-other-version",1],
        ["raw-malformed-exact",1], ["replacement-different",0], ["raw-blob-v-text",0],
      ],
      missingActor: true, productionRowsScanned: 0,
    });
    const allocator = body.allocator;
    assert.equal(allocator.fractionalRejected, true);
    assert.equal(allocator.atMaxSeq, Number.MAX_SAFE_INTEGER);
    assert.equal(allocator.maxToken.x_version, Number.MAX_SAFE_INTEGER);
    assert.equal(allocator.maxToken.user_version, allocator.oldVersions.user_version);
    assert.equal(allocator.allocatorOut.length, 6);
    for (const item of allocator.allocatorOut) {
      assert.equal(item.failed, true, item.policy);
      assert.deepEqual(item.versions, allocator.maxToken, item.policy);
      assert.equal(item.seq, Number.MAX_SAFE_INTEGER, item.policy);
      assert.equal(item.name, "at-max", item.policy);
    }
    assert.deepEqual(allocator.overflowBatch, {
      failed: true, snapshotCount: 0, refCount: 0, resource: "before",
      versions: allocator.maxToken, seq: Number.MAX_SAFE_INTEGER, name: "at-max",
    });
    assert.deepEqual(allocator.missing, {
      failed: true, versions: allocator.maxToken, name: "at-max", rows: 0,
    });
  } finally {
    await stopTree(child);
    try { fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }); } catch {}
  }
});
