import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../../migrations/0064_x_users_lower_id_index.sql");
const canonicalSchema = read("../db/schema.canonical.ts");
const probeSource = read("./publicStaticTargetProbe.ts");
const degradedQueriesSource = read("./degradedQueries.ts");

const xUsers = sqliteTable("x_users", { id: text("id").primaryKey() });
const dialect = new SQLiteSyncDialect();

test("migration 0064 and schema.canonical declare the lower(id) expression index", () => {
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS x_users_lower_id_idx\s+ON x_users \(lower\(id\)\);/,
  );
  assert.match(migration, /^-- Type: additive$/m);
  assert.match(migration, /^-- Data loss: none$/m);
  assert.match(
    canonicalSchema,
    /index\("x_users_lower_id_idx"\)\.on\(sql`lower\(\$\{t\.id\}\)`\)/,
  );
});

test("lower(x_users.id) probe lookups use the expression index and stay case-insensitive", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT)");
    db.exec(migration);
    const insert = db.prepare("INSERT INTO x_users (id, x_name) VALUES (?, ?)");
    for (let i = 0; i < 2000; i += 1) insert.run(`user${i}`, `name${i}`);
    insert.run("LegacyMixedCase", "legacy");

    const compiled = dialect.sqlToQuery(
      sql`SELECT ${xUsers.id} FROM ${xUsers} WHERE lower(${xUsers.id}) = ${"legacymixedcase"} LIMIT 1`,
    );
    const rows = db.prepare(compiled.sql).all(...compiled.params);
    assert.deepEqual(rows.map((row) => row.id), ["LegacyMixedCase"]);

    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`)
      .all(...compiled.params)
      .map((row) => String(row.detail))
      .join("\n");
    assert.match(plan, /SEARCH .*USING INDEX x_users_lower_id_idx/);
    assert.doesNotMatch(plan, /SCAN/);
  } finally {
    db.close();
  }
});

test("user probe and degraded profile lookup keep case-insensitive lower(id) matching", () => {
  assert.match(probeSource, /lower\(\$\{xUsers\.id\}\) = \$\{canonicalXId\}/);
  assert.match(degradedQueriesSource, /lower\(\$\{xUsers\.id\}\)/);
});
