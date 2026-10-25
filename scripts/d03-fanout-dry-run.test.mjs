import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeLocalFile } from "./d03-fanout-dry-run.mjs";

const CLI = new URL("./d03-fanout-dry-run.mjs", import.meta.url);
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "fn-mig-0658-"));
  const file = join(dir, "local.sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec([
      "CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT)",
      "CREATE TABLE x_user_account_links (auth_user_id TEXT, x_user_id TEXT, link_role TEXT)",
      "CREATE TABLE videos (id TEXT PRIMARY KEY, app_like_count INTEGER NOT NULL)",
      "CREATE TABLE video_interactions_auth (auth_user_id TEXT, video_id TEXT, interaction_type TEXT, created_at INTEGER)",
      "CREATE TABLE video_interactions (x_user_id TEXT, video_id TEXT, interaction_type TEXT, created_at INTEGER)",
    ].join(";") + ";");
    const insert = (sql, ...args) => db.prepare(sql).run(...args);
    fn({ db, file, insert });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const add = {
  x: (insert, id, state = "approved") =>
    insert("INSERT INTO x_users VALUES (?, ?)", id, state),
  link: (insert, user, x, role = "owner") =>
    insert("INSERT INTO x_user_account_links VALUES (?, ?, ?)", user, x, role),
  video: (insert, id, count = 0) =>
    insert("INSERT INTO videos VALUES (?, ?)", id, count),
  auth: (insert, user, video = "v1", type = "like", ts = 1) =>
    insert("INSERT INTO video_interactions_auth VALUES (?, ?, ?, ?)", user, video, type, ts),
  existing: (insert, x, video = "v1", type = "like", ts = 1) =>
    insert("INSERT INTO video_interactions VALUES (?, ?, ?, ?)", x, video, type, ts),
};

test("T01 approved owner only: manager/pending/rejected/imported excluded", () => fixture(({ insert, file }) => {
  add.video(insert, "v1");
  add.x(insert, "approved"); add.x(insert, "pending", "pending");
  add.x(insert, "rejected", "rejected"); add.x(insert, "imported", "imported");
  add.x(insert, "manager");
  add.link(insert, "a", "approved");
  add.link(insert, "a", "pending"); add.link(insert, "a", "rejected");
  add.link(insert, "a", "imported"); add.link(insert, "a", "manager", "manager");
  add.auth(insert, "a");
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 1);
  assert.equal(report.skippedNoOwnerLink, 0);
  assert.equal(report.collapsedDuplicates, 0);
  assert.deepEqual(report.likeCountDelta.map((v) => [v.videoId, v.delta]), [["v1", 1]]);
}));

test("T02 two Auth Users sharing one X collapse to one interaction", () => fixture(({ insert, file }) => {
  add.video(insert, "v1");
  add.x(insert, "x1");
  add.link(insert, "a", "x1");
  add.link(insert, "b", "x1");
  add.auth(insert, "a"); add.auth(insert, "b");
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 1);
  assert.equal(report.collapsedDuplicates, 1);
  assert.equal(report.likeCountDelta[0].projected, 1);
}));

test("T03 auth interaction without approved owner remains skipped", () => fixture(({ insert, file }) => {
  add.video(insert, "v1");
  add.x(insert, "onlyManager");
  add.link(insert, "a", "onlyManager", "manager");
  add.auth(insert, "a");
  add.auth(insert, "b", "v1", "bookmark");
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 0);
  assert.equal(report.skippedNoOwnerLink, 2);
  assert.deepEqual(report.likeCountDelta, []);
}));

test("T04 target collisions reported without overwriting an existing interaction", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 1); add.x(insert, "x1");
  add.link(insert, "a", "x1");
  add.auth(insert, "a", "v1", "like", 200);
  add.existing(insert, "x1", "v1", "like", 100);
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 1);
  assert.equal(report.conflictsWithVideoInteractions.count, 1);
  assert.deepEqual(report.conflictsWithVideoInteractions.first50.map((v) =>
    [v.xUserId, v.videoId, v.interactionType, v.candidateCreatedAt, v.existingCreatedAt]),
    [["x1", "v1", "like", 200, 100]]);
  assert.deepEqual(report.likeCountDelta, []);
}));

test("T05 running the CLI never changes source SQLite file bytes", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 0); add.x(insert, "x1");
  add.link(insert, "a", "x1"); add.auth(insert, "a");
  const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
  const before = hash();
  const child = spawnSync(process.execPath, [CLI.pathname, "--sqlite", file], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim().split("\n").length, 1);
  assert.equal(JSON.parse(child.stdout).candidates, 1);
  assert.equal(hash(), before);
}));
