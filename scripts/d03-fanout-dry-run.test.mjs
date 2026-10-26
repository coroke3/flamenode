import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { analyzeDatabase, analyzeLocalFile } from "./d03-fanout-dry-run.mjs";

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
  const child = spawnSync(process.execPath, [fileURLToPath(CLI), "--sqlite", file], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim().split("\n").length, 1);
  assert.equal(JSON.parse(child.stdout).candidates, 1);
  assert.equal(hash(), before);
}));


test("T06 concurrent local WAL writer cannot mix collision snapshots within one report", () => fixture(({ db, file, insert }) => {
  db.exec("PRAGMA journal_mode = WAL");
  add.video(insert, "v1", 0);
  add.x(insert, "x1"); add.link(insert, "a", "x1"); add.auth(insert, "a");
  const reader = new DatabaseSync(file, { readOnly: true, open: true });
  let writeCompleted = false;
  try {
    reader.exec("PRAGMA query_only = ON");
    const view = {
      exec: (sql) => reader.exec(sql),
      prepare: (sql) => {
        const stmt = reader.prepare(sql);
        if (!sql.includes("AS collisionCount")) return stmt;
        return {
          get() {
            const summary = stmt.get();
            // This write commits between the first and second SELECT. WAL lets
            // it proceed even while reader holds its read-only snapshot.
            add.existing(insert, "x1", "v1", "like", 777);
            writeCompleted = true;
            return summary;
          },
        };
      },
    };
    const report = analyzeDatabase(view);
    assert.equal(writeCompleted, true);
    assert.equal(report.candidates, 1);
    assert.equal(report.conflictsWithVideoInteractions.count, 0);
    assert.deepEqual(report.conflictsWithVideoInteractions.first50, []);
    assert.equal(report.likeCountDelta[0].projected, 1);
  } finally {
    reader.close();
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_interactions").get().n, 1);
}));

test("T07 an unexpected SELECT error still closes the read transaction", () => {
  const operations = [];
  assert.throws(() => analyzeDatabase({
    exec(sql) { operations.push(sql); },
    prepare() { throw new Error("snapshot unavailable"); },
  }), /snapshot unavailable/);
  assert.deepEqual(operations, ["BEGIN", "ROLLBACK"]);
});


test("T08 projected like counts include only approved legacy X and eligible fan-out", () => fixture(({ insert, db, file }) => {
  add.video(insert, "v1", 5);
  add.video(insert, "v2", 2);
  for (const [id, state] of [
    ["owner", "approved"], ["approvedLegacy", "approved"],
    ["pendingLegacy", "pending"], ["rejectedLegacy", "rejected"],
    ["importedLegacy", "imported"],
  ]) add.x(insert, id, state);
  add.link(insert, "a", "owner");
  add.auth(insert, "a", "v1", "like", 100);
  for (const id of ["approvedLegacy", "pendingLegacy", "rejectedLegacy", "importedLegacy"]) {
    add.existing(insert, id, "v1", "like", 10);
  }
  add.existing(insert, "owner", "v1", "bookmark", 12);
  add.existing(insert, "pendingLegacy", "v2", "like", 10);
  const before = db.prepare("SELECT COUNT(*) AS n FROM video_interactions").get().n;
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 1);
  assert.equal(report.likeCountDelta.find(x => x.videoId === "v1")?.projected, 2);
  assert.equal(report.likeCountDelta.find(x => x.videoId === "v1")?.delta, -3);
  assert.equal(report.likeCountDelta.find(x => x.videoId === "v2")?.projected, 0);
  assert.equal(report.likeCountDelta.find(x => x.videoId === "v2")?.delta, -2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_interactions").get().n, before,
    "dry-run never removes non-approved legacy rows");
}));

test("T09 one Auth interaction fans out to all approved owner X and deduplicates legacy likes", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 0);
  for (const x of ["xa", "xb", "xc"]) {
    add.x(insert, x);
    add.link(insert, "auth", x, "owner");
  }
  add.x(insert, "manager"); add.link(insert, "auth", "manager", "manager");
  add.x(insert, "pending", "pending"); add.link(insert, "auth", "pending", "owner");
  add.auth(insert, "auth", "v1", "like", 55);
  add.existing(insert, "xb", "v1", "like", 20);
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 3);
  assert.equal(report.collapsedDuplicates, 0);
  assert.equal(report.skippedNoOwnerLink, 0);
  assert.equal(report.conflictsWithVideoInteractions.count, 1);
  assert.equal(report.likeCountDeltaTotal, 1);
  assert.equal(report.likeCountDeltaTruncated, false);
  assert.deepEqual(report.likeCountDelta.map(({ videoId, projected, delta }) =>
    [videoId, projected, delta]), [["v1", 3, 3]]);
}));

test("T10 like discrepancy report exposes total and truncation beyond 50 videos", () => fixture(({ insert, file }) => {
  add.x(insert, "owner");
  add.link(insert, "auth", "owner");
  for (let i = 0; i < 57; i++) {
    const videoId = "v" + String(i).padStart(3, "0");
    add.video(insert, videoId, 0);
    add.auth(insert, "auth", videoId, "like", i);
  }
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 57);
  assert.equal(report.likeCountDeltaTotal, 57);
  assert.equal(report.likeCountDelta.length, 50);
  assert.equal(report.likeCountDeltaTruncated, true);
  assert.deepEqual(report.maxDeltaVideo, report.likeCountDelta[0]);
  assert.equal(report.maxDeltaVideo.videoId, "v000");
  assert.equal(report.likeCountDelta.at(-1).videoId, "v049");
  assert.ok(report.likeCountDelta.every(row => !("totalDeltas" in row)),
    "internal window count is not leaked into public row objects");
}));

test("T11 reports zero mismatches without falsely marking truncation", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 1);
  add.x(insert, "x1"); add.existing(insert, "x1", "v1", "like", 10);
  const report = analyzeLocalFile(file);
  assert.equal(report.likeCountDeltaTotal, 0);
  assert.equal(report.likeCountDeltaTruncated, false);
  assert.deepEqual(report.likeCountDelta, []);
  assert.equal(report.maxDeltaVideo, null);
}));

test("T12 collision report preserves the full count when first50 is truncated", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 57);
  add.auth(insert, "auth", "v1", "like", 999);
  for (let i = 0; i < 57; i++) {
    const xId = "x" + String(i).padStart(3, "0");
    add.x(insert, xId);
    add.link(insert, "auth", xId);
    add.existing(insert, xId, "v1", "like", i);
  }
  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 57);
  assert.equal(report.conflictsWithVideoInteractions.count, 57);
  assert.equal(report.conflictsWithVideoInteractions.first50.length, 50);
  assert.equal(report.conflictsWithVideoInteractions.truncated, true);
  assert.equal(report.conflictsWithVideoInteractions.first50[0].xUserId, "x000");
  assert.equal(report.conflictsWithVideoInteractions.first50.at(-1).xUserId, "x049");
  assert.deepEqual(report.likeCountDelta, [],
    "pre-existing approved-X likes must not be double-counted");
}));

test("T13 dedup preserves earliest Auth timestamp and does not overwrite legacy X collision", () => fixture(({ insert, file }) => {
  add.video(insert, "v1", 1);
  add.x(insert, "shared");
  add.link(insert, "authA", "shared");
  add.link(insert, "authB", "shared");
  add.auth(insert, "authA", "v1", "like", 500);
  add.auth(insert, "authB", "v1", "like", 200);
  add.auth(insert, "authA", "v1", "bookmark", 600);
  add.existing(insert, "shared", "v1", "like", 50);

  const report = analyzeLocalFile(file);
  assert.equal(report.candidates, 2);
  assert.equal(report.collapsedDuplicates, 1);
  assert.equal(report.conflictsWithVideoInteractions.count, 1);
  assert.deepEqual(report.conflictsWithVideoInteractions.first50.map(({ interactionType, candidateCreatedAt, existingCreatedAt }) =>
    [interactionType, candidateCreatedAt, existingCreatedAt]), [["like", 200, 50]]);
  assert.equal(report.likeCountDeltaTotal, 0, "existing X like and proposed duplicates count once");
  assert.equal(report.likeCountDeltaTruncated, false);
}));
test("T14 CLI script path containing spaces is decoded before spawning Node", () => fixture(({ insert, file }) => {
  add.video(insert, "v1");
  add.x(insert, "x1");
  add.link(insert, "auth", "x1");
  add.auth(insert, "auth");

  const copiedScript = join(dirname(file), "dry run with spaces.mjs");
  copyFileSync(fileURLToPath(CLI), copiedScript);
  const scriptUrl = pathToFileURL(copiedScript);
  assert.match(scriptUrl.href, /%20/, "URL path must contain encoded spaces");
  const child = spawnSync(process.execPath,
    [fileURLToPath(scriptUrl), "--sqlite", file], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).candidates, 1);
}));

test("T15 refuses missing and non-regular SQLite inputs without creating files", () => {
  const dir = mkdtempSync(join(tmpdir(), "fn-mig-0658-path-"));
  try {
    const missing = join(dir, "missing.sqlite");
    assert.throws(() => analyzeLocalFile(missing), /ENOENT/);
    assert.equal(existsSync(missing), false, "missing input must not be created");

    assert.throws(() => analyzeLocalFile(dir), /Expected an existing local SQLite file/);
    const child = spawnSync(process.execPath,
      [fileURLToPath(CLI), "--sqlite", dir], { encoding: "utf8" });
    assert.equal(child.status, 1, "directory input must exit unsuccessfully");
    assert.equal(child.stdout.trim(), "", "failed dry-run cannot emit a success report");
    assert.match(child.stderr, /Expected an existing local SQLite file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
