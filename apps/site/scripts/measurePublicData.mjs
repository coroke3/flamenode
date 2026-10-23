// MIG-0409 U03/U05(b)/U06 local measurement harness (Runtime N; never runs in a Worker).
//
// Builds the real D1 schema (every file in migrations/) in an in-memory SQLite, seeds the
// ZERO_1102.md §3 synthetic set (3,000 works, 20 events, 120 slots per event), and times
// CURRENT `workers/json-generator/rebuild.ts` `rebuildTarget` per target with
// `process.cpuUsage()` (user + system CPU of this Node process).
//
// These are LOCAL Node measurements. SQLite runs in-process here, so "D1 ms" (time spent
// inside the D1 shim: SQL execution + row materialisation) is reported separately; on
// Workers the SQL runs remotely and only result deserialisation is CPU. None of these
// numbers is a workerd or production CPU figure.
//
//   node --experimental-strip-types --no-warnings apps/site/scripts/measurePublicData.mjs \
//     --out <result.json> [--runs 50] [--snapshot <out.sqlite>]
// (CURRENT producers log to the console, so the result goes to a file.)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as CURRENT from "../../../workers/json-generator/rebuild.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));
export const SYNTHETIC = { works: 3000, events: 20, slotsPerEvent: 120, users: 1000, membersPerWork: 3 };

export function realSchemaDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return sqlite;
}

/** Seeds `works` public-ish videos (every 20th private) over the ZERO_1102 §3 shape. */
export function seedSynthetic(sqlite, { works = SYNTHETIC.works } = {}) {
  const { events, slotsPerEvent, users, membersPerWork } = SYNTHETIC;
  const base = 1_700_000_000;
  sqlite.exec("BEGIN");
  sqlite.prepare("INSERT INTO \"user\" (id, name) VALUES ('auth-1', 'Seeder')").run();
  const xUser = sqlite.prepare(
    "INSERT INTO x_users (id, x_name, icon_url, profile_text, approval_status) VALUES (?, ?, ?, ?, 'approved')",
  );
  for (let u = 0; u < users; u += 1) {
    xUser.run(`creator${u}`, `Creator ${u} 作者`, `https://img.example/u${u}.png`, `Profile ${u} `.repeat(8));
  }
  const event = sqlite.prepare(
    `INSERT INTO events (id, title, explanation, event_type, slot_type, start_time, end_time,
       entry_start_time, entry_end_time, visibility_status, created_at)
     VALUES (?, ?, ?, 'event', 'time', ?, ?, ?, ?, 'public', ?)`,
  );
  for (let e = 0; e < events; e += 1) {
    const start = base + e * 7 * 86400;
    event.run(`ev${e}`, `Event ${e} 合同`, `Explanation ${e} `.repeat(20), start, start + 6 * 3600,
      start - 30 * 86400, start - 86400, base - 86400);
  }
  const video = sqlite.prepare(
    `INSERT INTO videos (id, primary_event_id, creator_x_user_id, submitted_by_user_id,
       collaboration_type, creator_display_name, creator_icon_url, title, music, credit,
       youtube_video_id, intro_comment, highlights, visibility_status, scheduling_type,
       scheduled_time, app_like_count, score, created_at, updated_at)
     VALUES (?, ?, ?, 'auth-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'slotted', ?, ?, ?, ?, ?)`,
  );
  const videoEvent = sqlite.prepare("INSERT INTO video_events (video_id, event_id) VALUES (?, ?)");
  const member = sqlite.prepare(
    `INSERT INTO video_members (id, video_id, x_user_id, name, role, order_index, is_public_member)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  const slotted = events * slotsPerEvent;
  for (let w = 0; w < works; w += 1) {
    const id = `v${String(w).padStart(5, "0")}`;
    const eventId = w < slotted ? `ev${Math.floor(w / slotsPerEvent)}` : null;
    const creator = `creator${w % users}`;
    const at = base + w * 600;
    video.run(id, eventId, creator, w % 4 === 0 ? "collab" : "individual", `Creator ${w % users} 作者`,
      `https://img.example/u${w % users}.png`, `Work ${w} タイトル`, `Music ${w}`, `Credit ${w} `.repeat(4),
      `yt${String(w).padStart(9, "0")}`, `Intro ${w} `.repeat(10), `Highlights ${w} `.repeat(5),
      w % 20 === 19 ? "private" : "public", at, w % 50, (w * 7919) % 1000, at, at);
    if (eventId) videoEvent.run(id, eventId);
    for (let m = 0; m < membersPerWork; m += 1) {
      member.run(`${id}-m${m}`, id, `creator${(w + m + 1) % users}`, `Member ${m}`, m ? "mix" : "movie", m);
    }
  }
  const slot = sqlite.prepare(
    `INSERT INTO slots (id, event_id, x_user_id, display_name, slot_label, start_time, sort_order, video_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let e = 0; e < events; e += 1) {
    for (let s = 0; s < slotsPerEvent; s += 1) {
      const w = e * slotsPerEvent + s;
      const filled = w < works && s % 6 !== 5;
      slot.run(`ev${e}-s${s}`, `ev${e}`, filled ? `creator${w % users}` : null, filled ? `Creator ${w % users}` : null,
        `#${s + 1}`, base + e * 7 * 86400 + s * 180, s, filled ? `v${String(w).padStart(5, "0")}` : null,
        filled ? "submitted" : "available");
    }
  }
  sqlite.exec("COMMIT");
}

/** D1 shim over node:sqlite that accumulates the wall time spent inside SQLite. */
function sqliteD1(sqlite, stats) {
  const timed = (fn) => {
    const t0 = performance.now();
    try { return fn(); } finally { stats.d1Ms += performance.now() - t0; stats.statements += 1; }
  };
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async all() { return { results: timed(() => sqlite.prepare(sql).all(...args)), meta: {} }; },
    async first(column) {
      const row = timed(() => sqlite.prepare(sql).get(...args)) ?? null;
      return row && column ? row[column] : row;
    },
    async run() { return { meta: { changes: Number(timed(() => sqlite.prepare(sql).run(...args)).changes) } }; },
    async raw() { return timed(() => sqlite.prepare(sql).all(...args)).map((r) => Object.values(r)); },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(list) { const out = []; for (const item of list) out.push(await item.run()); return out; },
  };
}

/** In-memory R2 per SQLite DB, so producers that read other artifacts (blocklist, pool) find them. */
const r2Stores = new WeakMap();
function makeEnv(sqlite, stats) {
  if (!r2Stores.has(sqlite)) r2Stores.set(sqlite, new Map());
  const store = r2Stores.get(sqlite);
  const object = (body) => ({ text: async () => body, json: async () => JSON.parse(body), size: Buffer.byteLength(body) });
  return {
    DB: sqliteD1(sqlite, stats),
    R2: {
      head: async (key) => (store.has(key) ? { size: Buffer.byteLength(store.get(key)) } : null),
      get: async (key) => (store.has(key) ? object(store.get(key)) : null),
      put: async (key, body) => {
        const text = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
        store.set(key, text);
        stats.bytes += Buffer.byteLength(text);
        stats.keys.push(key);
      },
      delete: async (key) => { for (const k of [key].flat()) store.delete(k); },
      list: async () => ({ objects: [], truncated: false }),
    },
    KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

/** Runs `rebuildTarget(targetType, targetId)` once cold and `runs` times warm. */
/** CURRENT producers whose output other producers read (video pages need both). */
export async function seedPrerequisiteArtifacts(sqlite) {
  for (const type of ["youtube_related_blocklist", "random_video_pool"]) {
    await CURRENT.rebuildTarget(makeEnv(sqlite, { d1Ms: 0, statements: 0, bytes: 0, keys: [] }), type, "global");
  }
}

export async function measureTarget(sqlite, targetType, targetId, runs) {
  const samples = [];
  let cold = null;
  let last = null;
  // Every run starts from the R2 state before the first one, so CURRENT's "same
  // generation" skip never short-circuits a warm run: each sample is a full rebuild.
  makeEnv(sqlite, {});
  const before = new Map(r2Stores.get(sqlite));
  let after = before;
  for (let i = 0; i <= runs; i += 1) {
    r2Stores.set(sqlite, new Map(before));
    const stats = { d1Ms: 0, statements: 0, bytes: 0, keys: [] };
    const env = makeEnv(sqlite, stats);
    const c0 = process.cpuUsage();
    await CURRENT.rebuildTarget(env, targetType, targetId);
    const c = process.cpuUsage(c0);
    const sample = { cpuMs: (c.user + c.system) / 1000, d1Ms: stats.d1Ms, statements: stats.statements, bytes: stats.bytes, keys: stats.keys.length };
    if (i === 0) cold = sample; else samples.push(sample);
    last = sample;
    after = r2Stores.get(sqlite);
  }
  r2Stores.set(sqlite, after); // later composers read this producer's output
  const cpu = samples.map((s) => s.cpuMs).sort((a, b) => a - b);
  const nonD1 = samples.map((s) => Math.max(0, s.cpuMs - s.d1Ms)).sort((a, b) => a - b);
  return {
    target: `${targetType}:${targetId}`,
    runs,
    coldCpuMs: +cold.cpuMs.toFixed(2),
    cpuP50: +pct(cpu, 50).toFixed(2),
    cpuP95: +pct(cpu, 95).toFixed(2),
    cpuMax: +cpu[cpu.length - 1].toFixed(2),
    nonD1P50: +pct(nonD1, 50).toFixed(2),
    nonD1Max: +nonD1[nonD1.length - 1].toFixed(2),
    statements: last.statements,
    bytes: last.bytes,
    r2Puts: last.keys,
  };
}

function busiestUser(sqlite) {
  return sqlite.prepare(
    `SELECT creator_x_user_id AS id, COUNT(*) AS n FROM videos WHERE visibility_status = 'public'
     GROUP BY creator_x_user_id ORDER BY n DESC, id LIMIT 1`,
  ).get().id;
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf("--runs") + 1]) || 50;
  const outFile = args[args.indexOf("--out") + 1];
  if (!args.includes("--out") || !outFile) throw new Error("--out <result.json> is required");
  const snapshotAt = args.includes("--snapshot") ? args[args.indexOf("--snapshot") + 1] : null;
  const sqlite = realSchemaDb();
  seedSynthetic(sqlite);
  await seedPrerequisiteArtifacts(sqlite);
  if (snapshotAt) {
    fs.rmSync(snapshotAt, { force: true });
    sqlite.exec(`VACUUM INTO '${snapshotAt.replaceAll("'", "''")}'`);
  }
  const out = {
    measuredAt: new Date().toISOString(),
    machine: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()}` },
    synthetic: SYNTHETIC,
    perKind: [],
    families: [],
    shardProxy: [],
  };
  // U05(b) CURRENT per-entity JSON, largest synthetic input per kind. CURRENT builds an
  // event page from three section producers and then a composer ("event"), in this order.
  const perKind = [["video", "v00000"], ["user", busiestUser(sqlite)],
    ["event_base", "ev0"], ["event_slots", "ev0"], ["event_release", "ev0"], ["event", "ev0"]];
  for (const [type, id] of perKind) {
    out.perKind.push(await measureTarget(sqlite, type, id, runs));
  }
  // U06 whole-family rebuild (CURRENT) on the full synthetic set.
  for (const type of ["list_recent", "list_popular", "search_index", "events_index"]) {
    out.families.push(await measureTarget(sqlite, type, "global", Math.min(runs, 20)));
  }
  sqlite.close();
  // U06 shard proxy: the same CURRENT list producers over a DB holding only S public works,
  // i.e. the cost of rebuilding one list shard of S items with CURRENT's SQL + DTO + stringify.
  for (const works of [50, 100, 250, 500]) {
    const db = realSchemaDb();
    seedSynthetic(db, { works: Math.ceil(works / 0.95) });
    await seedPrerequisiteArtifacts(db);
    for (const type of ["list_recent", "search_index"]) {
      out.shardProxy.push({ shardWorks: works, ...(await measureTarget(db, type, "global", runs)) });
    }
    db.close();
  }
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
