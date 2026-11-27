import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
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
    "async function run(db, sql, params = []) { const r = await db.prepare(sql).bind(...params).run(); if (r.success !== true) throw new Error('D1 run failed'); return Number(r.meta?.changes ?? 0); }",
    "async function all(db, sql, params = []) { const r = await db.prepare(sql).bind(...params).all(); if (r.success !== true || !Array.isArray(r.results)) throw new Error('D1 all failed'); return r.results; }",
    "async function probe(db) {",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_user (id TEXT PRIMARY KEY, discord_id TEXT, name TEXT, active_x_user_id TEXT, image TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS u04a_x_users (id TEXT PRIMARY KEY, x_name TEXT NOT NULL, icon_url TEXT, actor_snapshot_version INTEGER NOT NULL DEFAULT 0)');",
    "  await run(db, 'CREATE TRIGGER IF NOT EXISTS u04a_user_version AFTER UPDATE OF discord_id, name, active_x_user_id, image ON u04a_user BEGIN UPDATE u04a_user SET actor_snapshot_version = actor_snapshot_version + 1 WHERE id = NEW.id; END');",
    "  await run(db, 'CREATE TRIGGER IF NOT EXISTS u04a_x_version AFTER UPDATE OF x_name, icon_url ON u04a_x_users BEGIN UPDATE u04a_x_users SET actor_snapshot_version = actor_snapshot_version + 1 WHERE id = NEW.id; END');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_snapshots_u04a (id TEXT PRIMARY KEY, discord_id, discord_name, active_x_user_id, user_image, x_name, x_icon_url, user_version INTEGER NOT NULL, x_version INTEGER NOT NULL)');",
    "  await run(db, 'CREATE TABLE IF NOT EXISTS audit_actor_refs_u04a (audit_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES audit_actor_snapshots_u04a(id))');",
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
    "  ];",
    "  const casesOut = [];",
    "  for (let i = 0; i < cases.length; i++) {",
    "    const item = cases[i];",
    "    await updateUser(item.user); await updateX(item.x);",
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
    "    await db.batch([",
    "      db.prepare(captureSql).bind('rolled-back', 'admin-1', current.user_version, current.x_version),",
    "      db.prepare('INSERT INTO u04a_forced_failure(value) VALUES (?)').bind(2),",
    "    ]);",
    "  } catch { rollbackFailed = true; }",
    "  const rollbackCount = Number((await all(db, \"SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id = 'rolled-back'\"))[0].n);",
    "  const abandonedCount = Number((await all(db, \"SELECT COUNT(*) AS n FROM audit_actor_snapshots_u04a WHERE id = 'abandoned'\"))[0].n);",
    "  const successVersions = await getVersions();",
    "  await db.batch([",
    "    db.prepare(captureSql).bind('kept', 'admin-1', successVersions.user_version, successVersions.x_version),",
    "    db.prepare('INSERT INTO audit_actor_refs_u04a (audit_id, snapshot_id) VALUES (?, ?)').bind('audit-u04a', 'kept'),",
    "  ]);",
    "  const successRef = (await all(db, \"SELECT snapshot_id FROM audit_actor_refs_u04a WHERE audit_id = 'audit-u04a'\"))[0]?.snapshot_id ?? null;",
    "  return { cases: casesOut, blobCanonicalJson: blobCase?.sourceJson ?? null, json1, json1Error, staleChanges, staleCount, rollbackFailed, rollbackCount, abandonedCount, successRef };",
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
    'compatibility_date = "2026-11-27"',
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
    assert.equal(body.cases.length, 7);
    for (const item of body.cases) {
      assert.equal(item.sourceJson, item.snapshotJson, item.label + " workerd canonical JSON bytes");
      assert.deepEqual(item.sourceBytes, item.snapshotBytes, item.label + " workerd raw DB bytes/storage classes");
    }
    assert.equal(body.cases.find(x => x.label === "empty-shadowed-fallback").iconUrl, "user-image");
    assert.ok(body.json1Error || body.json1 !== body.blobCanonicalJson, "SQL JSON1 unexpectedly matched invalid-UTF8/BLOB legacy JSON");
    assert.equal(body.staleChanges, 0);
    assert.equal(body.staleCount, 0);
    assert.equal(body.rollbackFailed, true);
    assert.equal(body.rollbackCount, 0);
    assert.equal(body.abandonedCount, 0);
    assert.equal(body.successRef, "kept");
  } finally {
    await stopTree(child);
    try { fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }); } catch {}
  }
});
