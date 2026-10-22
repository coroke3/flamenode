/**
 * Build-time snapshot producers (MIG-0509 pre-work / D-09). Writes every snapshot kind the Astro pages read
 * (about-stats, list/first-page, recommend, trending, top, users-index, user-profile and its paged siblings)
 * as the envelope the Phase 4 loaders verify: schemaVersion 1, generation, key, visibility "public",
 * sha256 of JSON.stringify(payload), plus the manifest (allowedKeys / blockedKeys).
 *
 * The payloads are produced by CURRENT's own R2 generators (`workers/json-generator/rebuild.ts`, `rebuildTarget`)
 * run against a database handle and an in-memory bucket, so the data rules, public-only SQL, visibility fences,
 * forbidden-key sanitizing and LIMITs are CURRENT's, not a copy. The bucket is captured, never uploaded.
 *
 * Safety: CURRENT's generators also write tracking rows (static_artifacts, static_rebuild_queue). The CLI
 * therefore only accepts a local file (a sqlite copy or a `wrangler d1 export` SQL dump) that it loads into a scratch
 * in-memory database; it never talks to Cloudflare. Production D1 access (read-only REST token, MIG-0409
 * `--d1-api`) is not used here: this producer runs about 6 statements per creator, far above that reader's
 * 19-request cap. How the build obtains the local copy is the MIG-0509 decision (see the work item).
 *
 * CLI: node --experimental-strip-types apps/site/scripts/produceSnapshots.ts
 *        (--sqlite FILE | --sql-dump FILE) --out DIR --generation ID [--trending-file FILE] [--now SEC]
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildTarget } from "../../../workers/json-generator/rebuild.ts";
import { readUserObjects } from "./batchedUserReader.ts";
import {
  ABOUT_STATS_KEY,
  LIST_FIRST_PAGE_KEY,
  RECOMMEND_KEY,
  TOP_KEY,
  TRENDING_KEY,
  USERS_INDEX_KEY,
  userProfileSnapshotKey,
  type SnapshotManifest,
} from "../src/lib/publicDataLoader.ts";
import { normalizeTopStatsSection, TOP_STATS_OBJECT_KEY } from "../../../src/lib/publicData/staticTopSectionsCore.ts";
import { normalizeStaticUsersIndex } from "../../../src/lib/publicData/staticUsersIndexCore.ts";
import { normalizeXId } from "../../../src/lib/utils/xid.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../../src/lib/utils/publicXUser.ts";

/** CURRENT `/list` page size: the first page is the only list content rendered at build time. */
export const LIST_FIRST_PAGE_SIZE = 24;
/** The loader refuses larger objects (MAX_OBJECT_BYTES); fail here with a clear reason instead. */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const BLOCKED_USER_LIMIT = 5000;
const X_ID_PATTERN = /^[a-z0-9_]{1,20}$/;

export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): unknown;
  };
}

export interface ProduceInput {
  /**
   * oracle (default): a scratch database, CURRENT's generators write tracking rows into it and run per creator.
   * batched: a READ-ONLY reader (MIG-0409 REST reader or a test wrapper); only SELECTs reach it, tracking
   * statements go to `scratch`, and creators are read with set-based queries (lead decision C').
   */
  db: D1Like;
  mode?: "oracle" | "batched";
  /** batched only: a schema-only database for CURRENT's tracking writes; default is a fresh migrated in-memory one. */
  scratch?: D1Like;
  creatorsPerQuery?: number;
  /** batched only: hard cap on statements sent to `db` (the REST reader's request budget). */
  maxRemoteStatements?: number;
  generation: string;
  /** Unix seconds recorded as `generated_at` where the generators read the clock. */
  nowSec?: number;
  /** Parsed `analytics/trending.json` (GA4 sync output; not derivable from D1). Absent = trending is not produced. */
  trending?: unknown;
}

export interface ProducedSnapshot {
  key: string;
  json: string;
  sha256: string;
}

export interface ProduceReport {
  generation: string;
  keys: number;
  bytes: number;
  d1Statements: number;
  creators: number;
  skippedCreators: string[];
  blockedKeys: number;
  trending: "produced" | "missing";
  rules: boolean;
  elapsedMs: number;
}

export interface ProduceResult {
  snapshots: ProducedSnapshot[];
  manifest: SnapshotManifest;
  /** CURRENT `rules/current.json` as is (`FLAMENODE_RULES_SNAPSHOT_FILE` reads it), null when D1 has no rules. */
  rules: unknown | null;
  report: ProduceReport;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** One verified envelope, byte-compatible with what `readVerifiedPayload` checks. */
export function wrapSnapshot(key: string, generation: string, payload: unknown): ProducedSnapshot {
  const json = JSON.stringify({
    schemaVersion: 1,
    generation,
    key,
    visibility: "public",
    sha256: sha256(JSON.stringify(payload)),
    payload,
  });
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Snapshot ${key} is ${Buffer.byteLength(json)} bytes, over the ${MAX_SNAPSHOT_BYTES} byte loader limit`);
  }
  return { key, json, sha256: sha256(JSON.stringify(payload)) };
}

function countingDb(db: D1Like, counter: { n: number }): D1Like {
  return {
    prepare(sql: string) {
      counter.n += 1;
      return db.prepare(sql);
    },
  };
}

/** Fixed part of a batched run is about 45 statements; creators add about 3 per `creatorsPerQuery` plus profile chunks. */
export const DEFAULT_MAX_REMOTE_STATEMENTS = 150;

/** Counts statements sent to the read-only reader, refuses anything that is not a single SELECT/WITH and enforces the cap. */
function limitedDb(db: D1Like, counter: { n: number }, max: number): D1Like {
  return {
    prepare(sql: string) {
      if (!/^\s*(SELECT|WITH)\b/i.test(sql) || sql.trim().replace(/;\s*$/, "").includes(";")) {
        throw new Error("read-only reader: only a single SELECT/WITH may reach the database");
      }
      counter.n += 1;
      if (counter.n > max) throw new Error(`read-only reader: request budget of ${max} statements exceeded`);
      return db.prepare(sql);
    },
  };
}

/**
 * CURRENT's generators also write tracking rows and read them back. Those statements (any write, and any read of a
 * tracking table) run on the local scratch database; every other statement goes to the read-only reader.
 */
export const LOCAL_TRACKING_TABLES = ["static_artifacts", "static_rebuild_queue"] as const;
const LOCAL_STATEMENT = new RegExp(
  `^\\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK)\\b|\\b(${LOCAL_TRACKING_TABLES.join("|")})\\b`,
  "i",
);

function overlayDb(remote: D1Like, local: D1Like): D1Like {
  return {
    prepare(sql: string) {
      if (LOCAL_STATEMENT.test(sql)) return local.prepare(sql);
      const base = remote.prepare(sql);
      let bound: { all(): Promise<{ results?: unknown[] }> } | null = null;
      const statement = {
        bind(...values: unknown[]) {
          bound = base.bind(...values) as typeof bound;
          return statement;
        },
        async all() {
          return (bound ?? (base.bind() as typeof bound))!.all();
        },
        async first() {
          const rows = (await statement.all()).results ?? [];
          return rows[0] ?? null;
        },
      };
      return statement as never;
    },
  };
}

/** A fresh in-memory database with every migration applied (schema only), for the tracking statements. */
export async function openMigratedScratch(migrationsDir: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations")): Promise<D1Like> {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort((a, b) => a.localeCompare(b))) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    if (name !== "0043_db_canonical_migration.sql") {
      sqlite.exec(sql);
    } else {
      sqlite.exec("BEGIN IMMEDIATE");
      sqlite.exec(sql);
      sqlite.exec("COMMIT");
    }
  }
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { params = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...(params as never[])) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as never[])) }; },
        async run() { const r = sqlite.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
      };
      return statement as never;
    },
  };
}

function captureEnv(db: D1Like) {
  const objects = new Map<string, unknown>();
  const kv = new Map<string, string>();
  const env = {
    DB: db,
    R2: {
      async get(key: string) {
        const payload = objects.get(key);
        if (payload === undefined) return null;
        return { async json() { return structuredClone(payload); } };
      },
      async head() { return null; },
      async put(key: string, body: unknown) { objects.set(key, JSON.parse(String(body))); },
      async delete(key: string) { objects.delete(key); },
    },
    KV: {
      async get(key: string) { return kv.get(key) ?? null; },
      async put(key: string, value: string) { kv.set(key, value); },
    },
  };
  return { env, objects };
}

async function firstRow(db: D1Like, sql: string, ...values: unknown[]): Promise<Record<string, unknown> | null> {
  const stmt = db.prepare(sql).bind(...values) as { first(): Promise<Record<string, unknown> | null> };
  return stmt.first();
}

async function allRows(db: D1Like, sql: string, ...values: unknown[]): Promise<Record<string, unknown>[]> {
  const stmt = db.prepare(sql).bind(...values) as { all(): Promise<{ results?: Record<string, unknown>[] }> };
  return (await stmt.all()).results ?? [];
}

export async function produceSnapshots(input: ProduceInput): Promise<ProduceResult> {
  const started = performance.now();
  const counter = { n: 0 };
  const batched = input.mode === "batched";
  const maxRemote = input.maxRemoteStatements ?? DEFAULT_MAX_REMOTE_STATEMENTS;
  const remote = batched ? limitedDb(input.db, counter, maxRemote) : countingDb(input.db, counter);
  const generatorDb = batched ? overlayDb(remote, input.scratch ?? (await openMigratedScratch())) : remote;
  const { env, objects } = captureEnv(generatorDb);
  const realNow = Date.now;
  if (input.nowSec !== undefined) Date.now = () => input.nowSec! * 1000;
  const skippedCreators: string[] = [];
  try {
    // Top sections first: CURRENT composes top.json from them (and about-stats reads top_stats).
    for (const target of ["top_recommended", "top_latest", "top_nostalgic", "top_events", "top_announcements", "top_stats", "top_slot_stats"]) {
      await rebuildTarget(env as never, target, "global");
    }
    await rebuildTarget(env as never, "top", "global");
    await rebuildTarget(env as never, "list_recent", "global");
    await rebuildTarget(env as never, "recommend_core", "global");
    await rebuildTarget(env as never, "users_index", "global");
    await rebuildTarget(env as never, "recommend", "global");
    await rebuildTarget(env as never, "rules", "global");

    const index = normalizeStaticUsersIndex((objects.get("users/index.json") ?? {}) as never);
    const creatorIds = [...new Set((index?.items ?? []).map((entry) => normalizeXId(entry.x_id)))].filter((id) => X_ID_PATTERN.test(id));
    if (batched) {
      const userObjects = await readUserObjects(remote, creatorIds, Math.floor(Date.now() / 1000), input.creatorsPerQuery);
      for (const [key, body] of userObjects) objects.set(key, body);
    } else {
      for (const id of creatorIds) await rebuildTarget(env as never, "user", id);
    }
    for (const id of creatorIds) if (!objects.has(`users/${id}.json`)) skippedCreators.push(id);

    const out: ProducedSnapshot[] = [];
    const add = (key: string, payload: unknown | undefined): void => {
      if (payload !== undefined) out.push(wrapSnapshot(key, input.generation, payload));
    };

    const stats = normalizeTopStatsSection(objects.get(TOP_STATS_OBJECT_KEY));
    // CURRENT RH-026: the three counts of the compact top stats object.
    add(ABOUT_STATS_KEY, stats ? { publicVideos: stats.stats.public_videos, creators: stats.stats.creators, events: stats.stats.public_events } : undefined);
    add(TOP_KEY, objects.get("top.json"));
    add(RECOMMEND_KEY, objects.get("recommend.json"));
    const recent = objects.get("list/recent.json") as { items?: unknown[]; total?: number } | undefined;
    add(LIST_FIRST_PAGE_KEY, recent ? { videos: (recent.items ?? []).slice(0, LIST_FIRST_PAGE_SIZE), total: recent.total } : undefined);
    add(TRENDING_KEY, input.trending);
    add(USERS_INDEX_KEY, objects.get("users/index.json"));
    for (const id of creatorIds) {
      if (!objects.has(`users/${id}.json`)) continue;
      add(userProfileSnapshotKey(id), objects.get(`users/${id}.json`));
      for (const section of ["works", "collabs"] as const) {
        for (let page = 2; page <= 5; page += 1) {
          add(userProfileSnapshotKey(id, section, page), objects.get(`users/${id}/${section}/${page}.json`));
        }
      }
    }

    // Visibility fence: creators that exist but are not publicly listable are named in blockedKeys so the loader
    // refuses them even if an object were ever left in the directory.
    const blocked = (await allRows(
      remote,
      `SELECT id FROM x_users WHERE approval_status NOT IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN}) LIMIT ?`,
      BLOCKED_USER_LIMIT,
    )).map((row) => normalizeXId(String(row.id))).filter((id) => X_ID_PATTERN.test(id));
    const blockedKeys = blocked.map((id) => userProfileSnapshotKey(id));
    const produced = new Set(out.map((s) => s.key));
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      generation: input.generation,
      allowedKeys: [...produced].sort(),
      blockedKeys: blockedKeys.filter((key) => !produced.has(key)).sort(),
    };
    const rules = objects.get("rules/current.json") ?? null;
    return {
      snapshots: out,
      manifest,
      rules,
      report: {
        generation: input.generation,
        keys: out.length,
        bytes: out.reduce((n, s) => n + Buffer.byteLength(s.json), 0),
        d1Statements: counter.n,
        creators: creatorIds.length - skippedCreators.length,
        skippedCreators,
        blockedKeys: manifest.blockedKeys.length,
        trending: input.trending === undefined ? "missing" : "produced",
        rules: rules !== null,
        elapsedMs: Math.round(performance.now() - started),
      },
    };
  } finally {
    Date.now = realNow;
  }
}

/** Writes `DIR/snapshot/...json`, `DIR/manifest.json` and `DIR/rules-current.json`; returns the env to use. */
export function writeSnapshotDir(outDir: string, result: ProduceResult): Record<string, string> {
  for (const snapshot of result.snapshots) {
    const file = path.join(outDir, snapshot.key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, snapshot.json);
  }
  const manifestFile = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(result.manifest, null, 2));
  const env: Record<string, string> = {
    FLAMENODE_SNAPSHOT_DIR: outDir,
    FLAMENODE_SNAPSHOT_MANIFEST_FILE: manifestFile,
    FLAMENODE_SNAPSHOT_GENERATION: result.manifest.generation,
  };
  if (result.rules !== null) {
    const rulesFile = path.join(outDir, "rules-current.json");
    fs.writeFileSync(rulesFile, JSON.stringify(result.rules));
    env.FLAMENODE_RULES_SNAPSHOT_FILE = rulesFile;
  }
  return env;
}

async function openScratchDb(args: { sqlite?: string; sqlDump?: string }): Promise<D1Like> {
  const { DatabaseSync } = await import("node:sqlite");
  const scratch = new DatabaseSync(":memory:");
  if (args.sqlite) {
    // Copy through the backup-free route: attach read-only and copy tables is overkill; load the file bytes.
    const source = new DatabaseSync(args.sqlite, { readOnly: true });
    const rows = source.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid").all() as { sql: string }[];
    for (const row of rows) scratch.exec(row.sql);
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) {
      const data = source.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      for (const row of data) {
        const cols = Object.keys(row);
        scratch.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
      }
    }
    source.close();
  } else if (args.sqlDump) {
    scratch.exec(fs.readFileSync(args.sqlDump, "utf-8"));
  } else {
    throw new Error("--sqlite FILE or --sql-dump FILE is required (no Cloudflare access from this producer)");
  }
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { params = values; return statement; },
        async first() { return scratch.prepare(sql).get(...(params as never[])) ?? null; },
        async all() { return { results: scratch.prepare(sql).all(...(params as never[])) }; },
        async run() { const r = scratch.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
      };
      return statement;
    },
  };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const out = argValue(argv, "--out");
  const generation = argValue(argv, "--generation");
  if (!out || !generation) throw new Error("--out DIR and --generation ID are required");
  const db = await openScratchDb({ sqlite: argValue(argv, "--sqlite"), sqlDump: argValue(argv, "--sql-dump") });
  const trendingFile = argValue(argv, "--trending-file");
  const nowArg = argValue(argv, "--now");
  const result = await produceSnapshots({
    db,
    mode: argv.includes("--batched") ? "batched" : "oracle",
    generation,
    nowSec: nowArg ? Number(nowArg) : undefined,
    trending: trendingFile ? JSON.parse(fs.readFileSync(trendingFile, "utf-8")) : undefined,
  });
  const env = writeSnapshotDir(out, result);
  console.log(JSON.stringify({ report: result.report, env }, null, 2));
  if (result.report.trending === "missing") {
    console.warn("[snapshots] trending was not produced (no --trending-file): the /trending and / builds fail closed until it is supplied");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
