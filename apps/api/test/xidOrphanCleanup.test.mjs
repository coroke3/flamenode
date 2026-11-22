import assert from "node:assert/strict";
import test from "node:test";
import { cleanupIconKey, cleanupOldXIconAfterCommit } from "../src/routes/xid/orphanCleanup.ts";
import { createAdminD1, seedEvent } from "./helpers/sqliteD1.mjs";

const OLD = "/api/media/xicons/x_one/old.png";
const NEW = "/api/media/xicons/x_one/new.png";

function setup() {
  const { db, sqlite, stats } = createAdminD1();
  sqlite.exec(`
    CREATE TABLE videos (id TEXT PRIMARY KEY, creator_icon_url TEXT);
    CREATE TABLE event_groups (id TEXT PRIMARY KEY, icon_url TEXT, img_url TEXT);
    CREATE TABLE static_artifacts (
      id TEXT PRIMARY KEY, object_key TEXT, target_type TEXT, deleted_at INTEGER
    );
  `);
  let deletes = [];
  let failDelete = false;
  const bucket = { delete: async (key) => {
    deletes.push(key);
    if (failDelete) throw new Error("R2 unavailable");
  } };
  return { db, sqlite, stats, bucket,
    get deletes() { return deletes; },
    fail() { failDelete = true; },
  };
}

test("SA-104 orphan cleanup deletes only unreferenced old X icon after commit", async () => {
  const h = setup();
  assert.equal(await cleanupOldXIconAfterCommit(h.db, h.bucket, OLD, NEW), true);
  assert.deepEqual(h.deletes, ["xicons/x_one/old.png"]);
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.batches, 0);
});

test("SA-104 orphan cleanup retains any referenced old image", async () => {
  for (const makeReference of [
    (db) => db.prepare("INSERT INTO x_users (id,x_name,icon_url) VALUES ('owner','Owner',?)").run(OLD),
    (db) => db.prepare("INSERT INTO videos (id,creator_icon_url) VALUES ('video',?)").run(OLD),
    (db) => seedEvent(db, { icon_url: OLD }),
    (db) => db.prepare("INSERT INTO event_groups (id,img_url) VALUES ('group',?)").run(OLD),
    (db) => db.prepare("INSERT INTO static_artifacts (id,object_key,target_type,deleted_at) VALUES ('artifact',?,'public_media',NULL)").run("xicons/x_one/old.png"),
  ]) {
    const h = setup();
    makeReference(h.sqlite);
    assert.equal(await cleanupOldXIconAfterCommit(h.db, h.bucket, OLD, NEW), false);
    assert.deepEqual(h.deletes, []);
  }
});

test("SA-104 cleanup refuses off-namespace, path traversal, staging, external URL and slash-key", async () => {
  const h = setup();
  for (const url of [
    "https://evil.example/api/media/xicons/foo.png",
    "/api/media/xicons/../private",
    "/api/media/xicons\\foo.png",
    "/api/media/xicons/staging/user/upload.png",
    "/api/media/event-icons/event.png",
    "/api/media/xicons/",
    "/api/media/video-icons/private\rname.png",
  ]) {
    assert.equal(cleanupIconKey(url), null, url);
    assert.equal(await cleanupOldXIconAfterCommit(h.db, h.bucket, url, NEW), false);
  }
  assert.equal(await cleanupOldXIconAfterCommit(h.db, h.bucket, OLD, OLD), false);
  assert.equal(h.stats.reads, 0, "no lookup when key is rejected");
  assert.deepEqual(h.deletes, []);
});

test("SA-104 cleanup is best effort after D1 read/R2 failures, never deletes uncertain keys", async () => {
  const h = setup();
  h.sqlite.exec("DROP TABLE event_groups");
  assert.equal(await cleanupOldXIconAfterCommit(h.db, h.bucket, OLD, NEW), false);
  assert.deepEqual(h.deletes, []);
  const r2 = setup();
  r2.fail();
  assert.equal(await cleanupOldXIconAfterCommit(r2.db, r2.bucket, OLD, NEW), false);
  assert.deepEqual(r2.deletes, ["xicons/x_one/old.png"]);
});
