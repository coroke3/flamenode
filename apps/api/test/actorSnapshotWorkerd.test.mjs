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

test("U04a: local workerd/D1 preserves raw actor snapshot bytes and version-fenced batch semantics", { timeout: 120_000 }, async () => {
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
    "const captureSql = 'INSERT INTO audit_actor_snapshots_u04a (id, discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url, user_version, x_version) SELECT ?, u.discord_id, u.name, u.active_x_user_id, u.image, x.x_name, x.icon_url, u.actor_snapshot_version, COALESCE(x.actor_snapshot_version, -1) FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ? AND u.actor_snapshot_version = ? AND COALESCE(x.actor_snapshot_version, -1) = ?';",
    "const sourceBytesSql = 'SELECT typeof(u.discord_id) AS discord_id_type, hex(CAST(u.discord_id AS BLOB)) AS discord_id_hex, typeof(u.name) AS discord_name_type, hex(CAST(u.name AS BLOB)) AS discord_name_hex, typeof(u.active_x_user_id) AS active_x_user_id_type, hex(CAST(u.active_x_user_id AS BLOB)) AS active_x_user_id_hex, typeof(u.image) AS user_image_type, hex(CAST(u.image AS BLOB)) AS user_image_hex, typeof(x.x_name) AS x_name_type, hex(CAST(x.x_name AS BLOB)) AS x_name_hex, typeof(x.icon_url) AS x_icon_url_type, hex(CAST(x.icon_url AS BLOB)) AS x_icon_url_hex FROM u04a_user u LEFT JOIN u04a_x_users x ON x.id = u.active_x_user_id WHERE u.id = ?';",
    "const snapshotBytesSql = 'SELECT typeof(discord_id) AS discord_id_type, hex(CAST(discord_id AS BLOB)) AS discord_id_hex, typeof(discord_name) AS discord_name_type, hex(CAST(discord_name AS BLOB)) AS discord_name_hex, typeof(active_x_user_id) AS active_x_user_id_type, hex(CAST(active_x_user_id AS BLOB)) AS active_x_user_id_hex, typeof(user_image) AS user_image_type, hex(CAST(user_image AS BLOB)) AS user_image_hex, typeof(x_name) AS x_name_type, hex(CAST(x_name AS BLOB)) AS x_name_hex, typeof(x_icon_url) AS x_icon_url_type, hex(CAST(x_icon_url AS BLOB)) AS x_icon_url_hex FROM audit_actor_snapshots_u04a WHERE id = ?';",
    "async function run(db, sql, params = []) { const statement = db.prepare(sql); const bound = params.length ? statement.bind(...params) : statement; const r = await bound.run(); if (r.success !== true) throw new Error('D1 run failed'); return Number(r.meta?.changes ?? 0); }",
    "async function all(db, sql, params = []) { const statement = db.prepare(sql); const bound = params.length ? statement.bind(...params) : statement; const r = await bound.all(); if (r.success !== true || !Array.isArray(r.results)) throw new Error('D1 all failed'); return r.results; }",
    "async function probe(db) {",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_user (id TEXT PRIMARY KEY, discord_id TEXT, name TEXT, active_x_user_id TEXT, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_x_users (id TEXT PRIMARY KEY, x_name TEXT NOT NULL, icon_url TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  // Test-only monotonic allocation: row incarnation must survive DELETE/reinsert, REPLACE and PK changes.",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_actor_sequence (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL CHECK (typeof(n) = \\'integer\\' AND n BETWEEN 0 AND 9007199254740991))');",
    "  await run(db, 'INSERT OR IGNORE INTO u04a_actor_sequence VALUES (1, 0)');",
    "  for (const [table, fields] of [['u04a_user', 'id, discord_id, name, active_x_user_id, image'], ['u04a_x_users', 'id, x_name, icon_url']]) {",
    "    for (const [kind, event] of [['insert', 'INSERT'], ['update', 'UPDATE OF ' + fields]]) {",
    "      await run(db, 'CREATE TRIGGER IF NOT EXISTS ' + table + '_' + kind + ' AFTER ' + event + ' ON ' + table + ' BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM u04a_actor_sequence WHERE id = 1 AND typeof(n) = \\'integer\\' AND n >= 0 AND n < 9007199254740991) THEN RAISE(ABORT, \\'ACTOR_VERSION_UNAVAILABLE\\') END; UPDATE u04a_actor_sequence SET n = n + 1 WHERE id = 1; UPDATE ' + table + ' SET actor_snapshot_version = (SELECT n FROM u04a_actor_sequence WHERE id = 1) WHERE id = NEW.id; END');",
    "    }",
    "  }",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_resource (id TEXT PRIMARY KEY, value TEXT NOT NULL)');",
    "  await run(db, \"INSERT OR IGNORE INTO u04a_resource VALUES ('target', 'before')\");",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_snapshots_u04a (id TEXT PRIMARY KEY, discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url, user_version INTEGER NOT NULL, x_version INTEGER NOT NULL)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_refs_u04a (audit_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES audit_actor_snapshots_u04a(id))');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_audit_inline (id TEXT PRIMARY KEY, actor_snapshot_json TEXT NOT NULL)');",
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
    "    casesOut.push({ label: item.label, sourceJson, snapshotJson, sourceBytes, snapshotBytes, iconUrl: actorSnapshotFromRow(snapshot).icon_url });",
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
    "    ['user-delete-reinsert', [\"DELETE FROM u04a_user WHERE id='admin-1'\", userInsert]],",
    "    ['x-delete-reinsert', [\"DELETE FROM u04a_x_users WHERE id='u04a-x'\", xInsert]],",
    "    ['user-replace', [userInsert.replace('INSERT INTO', 'INSERT OR REPLACE INTO')]],",
    "    ['x-replace', [xInsert.replace('INSERT INTO', 'INSERT OR REPLACE INTO')]],",
    "    ['user-pk-aba', [\"UPDATE u04a_user SET id='temp-user' WHERE id='admin-1'\", \"UPDATE u04a_user SET id='admin-1' WHERE id='temp-user'\"]],",
    "    ['x-pk-aba', [\"UPDATE u04a_x_users SET id='temp-x' WHERE id='u04a-x'\", \"UPDATE u04a_x_users SET id='u04a-x' WHERE id='temp-x'\"]],",
    "    ['user-update', [\"UPDATE u04a_user SET name='After' WHERE id='admin-1'\"]],",
    "    ['x-update', [\"UPDATE u04a_x_users SET x_name='X after' WHERE id='u04a-x'\"]],",
    "    ['user-delete', [\"DELETE FROM u04a_user WHERE id='admin-1'\"]],",
    "    ['x-delete', [\"DELETE FROM u04a_x_users WHERE id='u04a-x'\"]],",
    "    ['active-x-change', [\"UPDATE u04a_user SET active_x_user_id=NULL WHERE id='admin-1'\"]],",
    "    ['missing-x-to-present', [xInsert], \"DELETE FROM u04a_x_users WHERE id='u04a-x'\"],",
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
    "  for (const [label, changes, beforeAdmission] of casesFence) {",
    "    await resetActor();",
    "    if (beforeAdmission) await run(db, beforeAdmission);",
    "    const admitted = await getVersions();",
    "    for (const sql of changes) await run(db, sql);",
    "    const after = await getVersions();",
    "    const failed = await batchFailed(fencedBatch('fence-' + label, admitted));",
    "    fenceOut.push({ label, versionChanged: !after || admitted.user_version !== after.user_version || admitted.x_version !== after.x_version, failed, snapshotCount: await countSnapshot('fence-' + label), refCount: await countRef('fence-' + label), resource: await getResource() });",
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
    "  const beforeRollback = await getVersions();",
    "  const seqBefore = await getSeq();",
    "  const rollbackStatements = fencedBatch('fence-rollback', beforeRollback, [db.prepare(\"UPDATE u04a_x_users SET x_name='X after' WHERE id='u04a-x'\")]);",
    "  rollbackStatements.push(db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (2)'));",
    "  const lateFailed = await batchFailed(rollbackStatements);",
    "  const lateRollback = { failed: lateFailed, snapshotCount: await countSnapshot('fence-rollback'), refCount: await countRef('fence-rollback'), resource: await getResource(), beforeVersions: beforeRollback, afterVersions: await getVersions(), seqBefore, seqAfter: await getSeq(), liveName: (await all(db, sourceSql, ['admin-1']))[0]?.x_name };",
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
    "  return { cases: casesOut, blobCanonicalJson: blobCase?.sourceJson ?? null, blobJson1FixtureMatches, json1, json1Error, staleChanges, staleCount, rollbackFailed, rollbackCount, abandonedCount, successRef, fenceOut, positive, interleaving, interleavingFence, interleavingFailure, interleavingFailureFence, lateRollback, allocator };",
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
    assert.equal(body.fenceOut.length, 12);
    for (const item of body.fenceOut) {
      assert.equal(item.versionChanged, true, item.label);
      assert.equal(item.failed, true, item.label);
      assert.equal(item.snapshotCount, 0, item.label);
      assert.equal(item.refCount, 0, item.label);
      assert.equal(item.resource, "before", item.label);
    }
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
    const late = body.lateRollback;
    assert.equal(late.failed, true);
    assert.equal(late.snapshotCount, 0);
    assert.equal(late.refCount, 0);
    assert.equal(late.resource, "before");
    assert.deepEqual(late.afterVersions, late.beforeVersions);
    assert.equal(late.seqAfter, late.seqBefore);
    assert.equal(late.liveName, "X before");
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
