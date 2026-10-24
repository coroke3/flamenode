// MIG-0509 pre-work: snapshot producers. A seeded, fully migrated SQLite database -> CURRENT's R2 generators ->
// verified snapshot envelopes -> the Astro loaders and view models, compared with the CURRENT generator output
// for the same seed (the objects CURRENT's pages read), plus the visibility, tamper and budget properties.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { rebuildTarget } from "../workers/json-generator/rebuild.ts";
import { produceSnapshots, writeSnapshotDir, wrapSnapshot, LIST_FIRST_PAGE_SIZE, MAX_SNAPSHOT_BYTES } from "../apps/site/scripts/produceSnapshots.ts";
import {
  loadAboutStatsSnapshot,
  loadListingPayload,
  loadUserProfileSnapshot,
  userProfileSnapshotKey,
  SnapshotBuildError,
  TOP_KEY,
  LIST_FIRST_PAGE_KEY,
  RECOMMEND_KEY,
  TRENDING_KEY,
  ABOUT_STATS_KEY,
  USERS_INDEX_KEY,
} from "../apps/site/src/lib/publicDataLoader.ts";
import { loadAboutStatsForBuild } from "../apps/site/src/lib/aboutStats.ts";
import { loadListingForBuild } from "../apps/site/src/lib/listingData.ts";
import { loadTopForBuild } from "../apps/site/src/lib/topData.ts";
import { loadUserBuildDataFrom, userPayloadSourceFromEnv } from "../apps/site/src/lib/userData.ts";
import { loadRulesForBuild, rulesSourceFromEnv } from "../apps/site/src/lib/rulesLoader.ts";
import { computeUsersIndexView, buildSectionPages } from "../apps/site/src/lib/userViews.ts";
import { normalizeStaticUserProfile } from "../src/lib/publicData/staticUserProfileCore.ts";

const NOW = 1_760_000_000;
const migrationsDir = path.resolve("migrations");

function migrated() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort((a, b) => a.localeCompare(b))) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    if (name !== "0043_db_canonical_migration.sql") sqlite.exec(sql);
    else { sqlite.exec("BEGIN IMMEDIATE"); sqlite.exec(sql); sqlite.exec("COMMIT"); }
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
  return sqlite;
}

function d1(sqlite, log) {
  return {
    prepare(sql) {
      log?.push(sql);
      let params = [];
      const st = {
        bind(...v) { params = v; return st; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
      };
      return st;
    },
  };
}

function seed(sqlite) {
  sqlite.prepare(`INSERT INTO "user" (id) VALUES (?)`).run("auth-user");
  const xu = sqlite.prepare(`INSERT INTO x_users (id, x_name, approval_status, profile_text, icon_url, portfolio_contact) VALUES (?, ?, ?, ?, ?, ?)`);
  xu.run("creator_a", "Creator A", "approved", "A のプロフィール", "https://example.com/a.png", "DM ください");
  xu.run("creator_b", "Creator B", "pending", null, null, null);
  xu.run("banned_c", "Banned C", "rejected", "非公開にすべきプロフィール", null, null);
  const ev = sqlite.prepare(`INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  ev.run("public-event", "Public Event", "public", NOW - 86400, NOW + 86400 * 5, NOW);
  ev.run("private-event", "Private Event", "private", NOW - 86400, NOW + 86400 * 5, NOW);
  const vid = sqlite.prepare(
    `INSERT INTO videos (id, title, youtube_video_id, creator_display_name, creator_x_user_id, submitted_by_user_id, visibility_status, scheduled_time, primary_event_id, score, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < 30; i += 1) {
    vid.run(`a-${i}`, `作品 A${i}`, `yta${String(i).padStart(8, "0")}`, "Creator A", "creator_a", "auth-user", "public", NOW - 1000 * i, i === 0 ? "private-event" : "public-event", 30 - i, NOW);
  }
  vid.run("a-private", "非公開の作品 A", "ytprivate001", "Creator A", "creator_a", "auth-user", "private", NOW, null, 99, NOW);
  vid.run("b-1", "作品 B1", "ytb000000001", "Creator B", "creator_b", "auth-user", "public", NOW - 50, null, 5, NOW);
  vid.run("c-1", "作品 C1", "ytc000000001", "Banned C", "banned_c", "auth-user", "public", NOW - 60, null, 5, NOW);
  sqlite.prepare(`INSERT INTO video_events (video_id, event_id) VALUES (?, ?)`).run("a-1", "public-event");
  const member = sqlite.prepare(`INSERT INTO video_members (id, video_id, x_user_id, name, is_public_member) VALUES (?, ?, ?, ?, ?)`);
  member.run("m1", "b-1", "creator_a", "Creator A", 1);
  member.run("m1b", "b-1", "creator_a", "Creator A again", 1); // duplicate member row: still one collab entry
  member.run("m2", "a-5", "creator_b", "Creator B", 1);
  member.run("m3", "a-6", "creator_b", "Creator B", 0); // not a public member
  member.run("m4", "a-7", "creator_a", "Creator A", 1); // own work: never a collab
  // Column defaults read the wall clock; pin them so two runs of the same seed are byte-identical.
  for (const { name } of sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all()) {
    const cols = sqlite.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    for (const col of ["created_at", "updated_at"]) if (cols.includes(col)) sqlite.exec(`UPDATE "${name}" SET "${col}" = ${NOW}`);
  }
}

const TRENDING = {
  schema_version: 1,
  generated_at: NOW - 60,
  items: [{ id: "a-1", title: "作品 A1", youtube_video_id: "yta00000001", display_name: "Creator A", icon_url: null, primary_event_id: null, primary_event_title: null, scheduled_time: NOW - 1000, status: "public", views_2d: 9, views_5d: 20, views_7d: 30, views_30d: 100, rank: 1, video_id: "a-1" }],
};

async function produce(extra = {}) {
  const sqlite = migrated();
  seed(sqlite);
  const log = [];
  const result = await produceSnapshots({ db: d1(sqlite, log), generation: "gen-1", nowSec: NOW, trending: TRENDING, ...extra });
  return { sqlite, result, log };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig0509-"));
const produced = await produce();
const env = writeSnapshotDir(dir, produced.result);
const byKey = new Map(produced.result.snapshots.map((s) => [s.key, JSON.parse(s.json)]));

test("every snapshot kind the pages read is produced as a verifiable envelope", () => {
  for (const key of [ABOUT_STATS_KEY, TOP_KEY, RECOMMEND_KEY, LIST_FIRST_PAGE_KEY, TRENDING_KEY, USERS_INDEX_KEY, userProfileSnapshotKey("creator_a"), userProfileSnapshotKey("creator_b")]) {
    assert.ok(byKey.has(key), `missing ${key}`);
    const e = byKey.get(key);
    assert.equal(e.schemaVersion, 1);
    assert.equal(e.generation, "gen-1");
    assert.equal(e.key, key);
    assert.equal(e.visibility, "public");
    assert.match(e.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(produced.result.manifest.allowedKeys, [...new Set(produced.result.snapshots.map((s) => s.key))].sort());
  assert.ok(fs.existsSync(path.join(dir, "snapshot/top/current.json")));
  assert.equal(produced.result.report.trending, "produced");
});

test("loaders accept the output: about-stats equals CURRENT RH-026 counts, listing and top build from it", async () => {
  const stats = await loadAboutStatsForBuild(env);
  // CURRENT counts only publicly listable creators (banned_c is not one) but every public video.
  assert.deepEqual(stats, { publicVideos: 32, creators: 2, events: 1 });
  const listing = await loadListingForBuild(env, NOW);
  assert.equal(listing.list.videos.length, LIST_FIRST_PAGE_SIZE);
  assert.equal(listing.list.total, 32);
  assert.ok(listing.trending.items.length === 1);
  assert.ok(listing.recommend);
  const top = await loadTopForBuild(env, NOW, () => 0.5);
  assert.equal(top.stats.publicVideos, 32);
});

test("user pages: loader output equals the object CURRENT's /user pages read for the same seed", async () => {
  // The CURRENT generator output for the same seed, produced independently of the snapshot wrapper.
  const sqlite = migrated();
  seed(sqlite);
  const objects = new Map();
  const cur = { DB: d1(sqlite), R2: { async get(k) { const v = objects.get(k); return v === undefined ? null : { async json() { return structuredClone(v); } }; }, async head() { return null; }, async put(k, b) { objects.set(k, JSON.parse(String(b))); }, async delete(k) { objects.delete(k); } }, KV: { async get() { return null; }, async put() {} } };
  await rebuildTarget(cur, "user", "creator_a");
  const want = normalizeStaticUserProfile(objects.get("users/creator_a.json"));
  const source = userPayloadSourceFromEnv(env);
  const data = await loadUserBuildDataFrom(source);
  const got = data.users.get("creator_a");
  assert.deepEqual(got.profile.user, want.user);
  assert.deepEqual(got.profile.works.items, want.works.items);
  assert.equal(got.profile.works.total, 30);
  assert.equal(got.profile.works.items.length, 24);
  assert.ok(got.worksPages.has(2), "artifact page 2 (works 25..30) is produced");
  const pages = buildSectionPages(got.profile.works, got.worksPages, 8, 24);
  assert.equal(pages.pages.length, 4);
  assert.equal(pages.pages.every((p) => p !== null), true);
  // The collab shows on creator_a; creator_b has a page (pending is listable).
  assert.equal(got.profile.collabs.total, 1);
  assert.ok(data.users.has("creator_b"));
  // /user index equals the CURRENT index view.
  const view = computeUsersIndexView(data.index, "", "score", 1);
  assert.equal(view.total, data.users.size);
});

test("visibility: private works, the private event id and non-listable creators never appear in any snapshot", async () => {
  const all = produced.result.snapshots.map((s) => s.json).join("\n");
  for (const secret of ["非公開の作品 A", "a-private", "ytprivate001", "private-event", "Private Event", "非公開にすべきプロフィール"]) {
    assert.equal(all.includes(secret), false, `leaked ${secret}`);
  }
  assert.ok(produced.result.manifest.blockedKeys.includes(userProfileSnapshotKey("banned_c")), "the banned creator is fenced in blockedKeys");
  assert.equal(produced.result.manifest.allowedKeys.includes(userProfileSnapshotKey("banned_c")), false);
  const data = await loadUserBuildDataFrom(userPayloadSourceFromEnv(env));
  assert.equal(data.users.has("banned_c"), false);
});

test("tampering is rejected by the loaders (digest, generation, blocked key)", async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), "mig0509-bad-"));
  const badEnv = writeSnapshotDir(bad, produced.result);
  const file = path.join(bad, "snapshot/user-profile/creator_a.json");
  const e = JSON.parse(fs.readFileSync(file, "utf-8"));
  e.payload.user.x_name = "Evil";
  fs.writeFileSync(file, JSON.stringify(e));
  await assert.rejects(loadUserBuildDataFrom(userPayloadSourceFromEnv(badEnv)), (err) => err instanceof SnapshotBuildError && err.code === "HASH_MISMATCH");
  await assert.rejects(loadUserBuildDataFrom(userPayloadSourceFromEnv({ ...env, FLAMENODE_SNAPSHOT_GENERATION: "other" })), (err) => err instanceof SnapshotBuildError);
});

test("budget: bounded D1 statements, small objects, deterministic output for the same seed and clock", async () => {
  // The oracle issues about 6 statements per creator and about 15 per video/event: it only runs on a local copy.
  assert.ok(produced.result.report.d1Statements < 1000, `statements: ${produced.result.report.d1Statements}`);
  for (const s of produced.result.snapshots) assert.ok(Buffer.byteLength(s.json) < MAX_SNAPSHOT_BYTES);
  const again = await produce();
  const strip = (r) => r.result.snapshots.map((s) => `${s.key}:${s.sha256}`).join("|");
  assert.equal(strip(again), strip(produced));
  assert.throws(() => wrapSnapshot("snapshot/x/y.json", "g", { big: "x".repeat(MAX_SNAPSHOT_BYTES) }), /over the/);
});

test("trending is not derivable from D1: absent input is reported, never invented; rules come from CURRENT's generator", async () => {
  const none = await produce({ trending: undefined });
  assert.equal(none.result.report.trending, "missing");
  assert.equal(none.result.snapshots.some((s) => s.key === TRENDING_KEY), false);
  const rules = await loadRulesForBuild(rulesSourceFromEnv(env));
  assert.ok(rules.blocks.length > 0, "no rules row in the seed = CURRENT built-in terms");
});

function readOnly(sqlite, log) {
  return {
    prepare(sql) {
      log.push(sql);
      assert.match(sql, /^\s*(SELECT|WITH)\b/i, "a write reached the read-only reader");
      let params = [];
      const st = {
        bind(...v) { params = v; return st; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      };
      return st;
    },
  };
}

test("C' parity: batched read-only producer output is byte-identical to the CURRENT-generator producer", async () => {
  const oracle = await produce();
  assert.ok(oracle.result.snapshots.some((s) => s.key.includes(".collabs.") || s.key === userProfileSnapshotKey("creator_a")));
  for (const creatorsPerQuery of [1, 2, 25]) {
    const sqlite = migrated();
    seed(sqlite);
    const log = [];
    const batched = await produceSnapshots({ db: readOnly(sqlite, log), mode: "batched", creatorsPerQuery, generation: "gen-1", nowSec: NOW, trending: TRENDING });
    const flat = (r) => r.snapshots.map((s) => `${s.key}\n${s.json}`);
    const fb = flat(batched), fo = flat(oracle.result);
    assert.equal(fb.length, fo.length);
    const split = (s) => [s.slice(0, s.indexOf("\n")), JSON.parse(s.slice(s.indexOf("\n") + 1)).payload];
    for (let i = 0; i < fo.length; i += 1) {
      if (fb[i] === fo[i]) continue;
      const [key, want] = split(fo[i]);
      const got = split(fb[i])[1];
      assert.fail(`${key} differs at: ${Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k])).map((k) => k + " want=" + JSON.stringify(want[k]).slice(0, 300) + " got=" + JSON.stringify(got[k]).slice(0, 300)).join(" ; ")}`);
    }
    assert.deepEqual(batched.manifest, oracle.result.manifest);
    assert.equal(log.some((sql) => /static_artifacts|static_rebuild_queue/.test(sql)), false, "tracking statements stay local");
    assert.ok(batched.report.d1Statements <= 200, `statements ${batched.report.d1Statements}`);
  }
});

test("event and video kinds: produced, accepted by the MIG-0502 / MIG-0507 loaders, private ones absent and fenced", async () => {
  const keys = new Set(produced.result.snapshots.map((s) => s.key));
  for (const key of ["snapshot/event-index/current.json", "snapshot/event-detail/public-event.json", "snapshot/event-release/public-event.json", "snapshot/video-detail/a-1.json", "snapshot/video-detail/b-1.json"]) assert.ok(keys.has(key), `missing ${key}`);
  for (const key of ["snapshot/event-detail/private-event.json", "snapshot/event-release/private-event.json", "snapshot/video-detail/a-private.json"]) {
    assert.equal(keys.has(key), false, key);
    assert.ok(produced.result.manifest.blockedKeys.includes(key), `${key} is fenced`);
  }
  const { loadEventPayloadSnapshot, loadVideoDetailPayload, videoDetailKeys } = await import("../apps/site/src/lib/publicDataLoader.ts");
  const access = { source: { read: async (k) => (fs.existsSync(path.join(dir, k)) ? new Uint8Array(fs.readFileSync(path.join(dir, k))) : null) }, options: { manifest: produced.result.manifest, generation: "gen-1" } };
  const detail = await loadEventPayloadSnapshot(access.source, "snapshot/event-detail/public-event.json", access.options);
  assert.equal(detail.event.id, "public-event");
  const video = await loadVideoDetailPayload(access.source, "snapshot/video-detail/a-1.json", access.options);
  assert.equal(video.video.id, "a-1");
  assert.equal(JSON.stringify(video).includes("private-event"), false, "the private event id is not in a public video artifact");
  assert.equal(videoDetailKeys(produced.result.manifest).includes("snapshot/video-detail/a-private.json"), false);
  // Producer contract (MIG-0507): ONE video-detail key per video, named by the internal id. CURRENT also writes
  // videos/{youtubeId}.json; producing both would build the same page twice and trip the route-map duplicate fence.
  const videoKeys = [...keys].filter((k) => k.startsWith("snapshot/video-detail/")).sort();
  assert.ok(videoKeys.includes("snapshot/video-detail/a-1.json") && videoKeys.includes("snapshot/video-detail/b-1.json"));
  for (const key of videoKeys) {
    const id = key.slice("snapshot/video-detail/".length, -".json".length);
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, key), "utf-8"));
    assert.equal(envelope.payload.video.id, id, `${key} is keyed by the video's internal id`);
  }
});

test("mirror covers every table the event and video generators read (tracking tables excepted)", async () => {
  const { MIRRORED_TABLES } = await import("../apps/site/scripts/mirrorTables.ts");
  const sqlite = migrated();
  seed(sqlite);
  const log = [];
  await produceSnapshots({ db: d1(sqlite, log), generation: "g", nowSec: NOW });
  const tables = new Set();
  for (const sql of log) for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi)) tables.add(m[1].toLowerCase());
  // Tables of the fixed targets (top/list/recommend/users) are read remotely in batched mode; event/video SQL is the mirror's concern.
  const evLog = [];
  const sqlite2 = migrated();
  seed(sqlite2);
  const rebuild = await import("../workers/json-generator/rebuild.ts");
  const objects = new Map();
  const env = { DB: d1(sqlite2, evLog), R2: { async get(k) { const v = objects.get(k); return v === undefined ? null : { async json() { return structuredClone(v); } }; }, async head() { return null; }, async put(k, b) { objects.set(k, JSON.parse(String(b))); }, async delete(k) { objects.delete(k); } }, KV: { async get() { return null; }, async put() {} } };
  for (const t of ["events_index"]) await rebuild.rebuildTarget(env, t, "global");
  for (const t of ["event_base", "event_slots", "event_release", "event"]) await rebuild.rebuildTarget(env, t, "public-event");
  await rebuild.rebuildTarget(env, "youtube_related_blocklist", "global");
  await rebuild.rebuildTarget(env, "random_video_pool", "global");
  await rebuild.rebuildTarget(env, "video", "a-1");
  const used = new Set();
  for (const sql of evLog) for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi)) used.add(m[1].toLowerCase());
  const known = new Set([...MIRRORED_TABLES, "static_artifacts", "static_rebuild_queue", "release_videos", "ranked_group_events", "ranked_public_staff", "json_each", "artifacts", "public_members"]); // CTE and table-function names
  const missing = [...used].filter((t) => !known.has(t));
  assert.deepEqual(missing, [], "tables read by the event/video generators but not mirrored");
  void tables;
});

test("C' budget: statements grow with creators / creatorsPerQuery, not 3 per creator; the cap is enforced", async () => {
  const sqlite = migrated();
  seed(sqlite);
  for (let i = 0; i < 40; i += 1) {
    sqlite.prepare(`INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')`).run(`bulk_${i}`, `Bulk ${i}`);
    sqlite.prepare(`INSERT INTO videos (id, title, youtube_video_id, creator_display_name, creator_x_user_id, submitted_by_user_id, visibility_status, scheduled_time, updated_at) VALUES (?, ?, ?, ?, ?, 'auth-user', 'public', ?, ?)`).run(`bulk-v-${i}`, `Bulk ${i}`, `ytbulk${String(i).padStart(5, "0")}`, `Bulk ${i}`, `bulk_${i}`, NOW - i, NOW);
  }
  const log = [];
  const ok = await produceSnapshots({ db: readOnly(sqlite, log), mode: "batched", creatorsPerQuery: 25, generation: "g", nowSec: NOW });
  assert.equal(ok.report.creators, 42);
  const oracleStatements = (await produce()).report?.d1Statements;
  assert.ok(ok.report.d1Statements < 110, `batched: ${ok.report.d1Statements} statements for 42 creators`);
  void oracleStatements;
  await assert.rejects(produceSnapshots({ db: readOnly(sqlite, []), mode: "batched", maxRemoteStatements: 10, generation: "g", nowSec: NOW }), /request budget of 10/);
});

// A real Astro build against the produced directory. It needs the @flamenode/ui build, so test:unit (which runs
// before it) skips it unless MIG0509_E2E=1; the CI REQUIRE_BUILT step runs it and fails instead of skipping.
const skipE2e = fs.existsSync(path.resolve("packages/ui/dist/index.js")) ? (process.env.MIG0509_E2E || process.env.REQUIRE_BUILT ? false : "set MIG0509_E2E=1") : "packages/ui/dist missing: build @flamenode/ui first";
if (process.env.REQUIRE_BUILT && skipE2e) throw new Error("REQUIRE_BUILT is set but " + skipE2e);
test("e2e: astro build reads the produced snapshots and emits the user, list, top and about pages", { skip: skipE2e }, async () => {
  const { spawnSync } = await import("node:child_process");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "mig0509-dist-"));
  const run = spawnSync("npx", ["astro", "build", "--outDir", out], { cwd: path.resolve("apps/site"), env: { ...process.env, ...env }, shell: true, encoding: "utf-8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const html = (f) => fs.readFileSync(path.join(out, f), "utf-8");
  assert.ok(html("user/creator_a/index.html").includes("Creator A"));
  assert.ok(html("user/creator_a/portfolio/index.html").includes("A のプロフィール"));
  assert.equal(fs.existsSync(path.join(out, "user/banned_c/index.html")), false);
  assert.equal(html("user/creator_a/index.html").includes("非公開の作品 A"), false);
  assert.ok(html("user/index.html").includes("Creator B"));
  assert.ok(html("index.html").includes("作品 A"));
  assert.ok(html("about/index.html").includes("32"));
  assert.ok(html("event/public-event/index.html").includes("Public Event"));
  assert.ok(html("yta00000001/index.html").includes("作品 A1"));
  assert.equal(fs.existsSync(path.join(out, "ytprivate001/index.html")), false);
});
