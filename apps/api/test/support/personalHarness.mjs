import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ENTRY_ENV = "FLAMENODE_TSX_TEST_ENTRY";
const REPO_ROOT = new URL("../../../../", import.meta.url);

/**
 * Re-runs the test file under tsx with the repository root as cwd, so CURRENT `src/**` modules
 * (which use the `@/` alias) can be imported as the parity reference. Returns true inside the tsx run.
 */
export function runUnderRootTsx(entryUrl) {
  const entryPath = fileURLToPath(entryUrl);
  if (process.env[ENTRY_ENV] === entryPath) return true;
  const env = { ...process.env, [ENTRY_ENV]: entryPath };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", entryPath], {
    stdio: "inherit",
    env,
    cwd: fileURLToPath(REPO_ROOT),
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return false;
}

/** In-memory SQLite with every migration applied (the real D1 schema). */
export function createSqlite() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  const dir = new URL("migrations/", REPO_ROOT);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, dir), "utf8"));
  }
  db.exec("PRAGMA foreign_keys = OFF");
  return db;
}

export function insert(sqlite, table, row) {
  const keys = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...keys.map((k) => row[k]));
}

/** D1Database look-alike over node:sqlite that counts statements, batches and bind parameters. */
export function createD1(sqlite) {
  const stats = { statements: 0, batches: 0, maxBinds: 0, writes: 0 };
  const READ = /^\s*(SELECT|WITH)\b/i;
  function statement(sql, params) {
    const self = {
      bind(...values) {
        return statement(sql, values);
      },
      async all() {
        return run(sql, params);
      },
      async first() {
        return run(sql, params).results[0] ?? null;
      },
    };
    self.__sql = sql;
    self.__params = params;
    return self;
  }
  function run(sql, params) {
    if (!READ.test(sql)) stats.writes += 1;
    stats.statements += 1;
    stats.maxBinds = Math.max(stats.maxBinds, params.length);
    const results = sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));
    return { results, success: true, meta: {} };
  }
  return {
    stats,
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      stats.batches += 1;
      return statements.map((s) => run(s.__sql, s.__params));
    },
  };
}

export function fakeBucket(objects) {
  return {
    async head(key) {
      const value = objects[key];
      if (value === undefined) return null;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return { size: Buffer.byteLength(text), etag: `etag-${key}` };
    },
    async get(key) {
      const value = objects[key];
      if (value === undefined) return null;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return {
        size: Buffer.byteLength(text),
        body: { cancel: async () => {} },
        json: async () => JSON.parse(text),
      };
    },
  };
}

export function cookie(token) {
  return { cookie: `authjs.session-token=${token}` };
}
