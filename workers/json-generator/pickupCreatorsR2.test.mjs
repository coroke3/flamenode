import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  PICKUP_CREATORS_OBJECT_KEY,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import {
  loadPickupCreatorsFromR2,
  resolvePickupCreatorsWithFallback,
} from "./pickupCreatorsR2.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

function applyActiveMigrations(sqlite) {
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const name of migrationNames) {
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    if (name !== "0043_db_canonical_migration.sql") {
      sqlite.exec(sql);
      continue;
    }
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(sql);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
}

function d1FromSqlite(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        },
      };
      return statement;
    },
  };
}

const validArtifact = {
  schema_version: 1,
  generated_at: 100,
  creators: [
    {
      id: "creator",
      x_name: "Creator",
      icon_url: null,
      video_count: 1,
      collab_count: 0,
    },
  ],
};

test("loadPickupCreatorsFromR2 は正常 artifact を読む", async () => {
  const result = await loadPickupCreatorsFromR2({
    R2: {
      async get(key) {
        assert.equal(key, PICKUP_CREATORS_OBJECT_KEY);
        return {
          async json() {
            return validArtifact;
          },
        };
      },
    },
  });
  assert.deepEqual(result, { ok: true, creators: validArtifact.creators });
});

test("loadPickupCreatorsFromR2 は missing を検知する", async () => {
  const result = await loadPickupCreatorsFromR2({
    R2: { async get() { return null; } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing");
});

test("loadPickupCreatorsFromR2 は corrupt JSON を拒否する", async () => {
  const result = await loadPickupCreatorsFromR2({
    R2: {
      async get() {
        return {
          async json() {
            return { schema_version: 1, generated_at: 1 };
          },
        };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_creators");
});

test("loadPickupCreatorsFromR2 は schema mismatch を拒否する", async () => {
  const result = await loadPickupCreatorsFromR2({
    R2: {
      async get() {
        return {
          async json() {
            return { schema_version: 2, generated_at: 1, creators: [] };
          },
        };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "schema_mismatch");
});

test("loadPickupCreatorsFromR2 は get error を拒否する", async () => {
  const result = await loadPickupCreatorsFromR2({
    R2: {
      async get() {
        throw new Error("r2 down");
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "get_error");
});

test("resolvePickupCreatorsWithFallback は R2 成功時に D1 を呼ばない", async () => {
  let d1Called = false;
  const creators = await resolvePickupCreatorsWithFallback(
    {
      R2: {
        async get() {
          return {
            async json() {
              return validArtifact;
            },
          };
        },
      },
      DB: {
        prepare() {
          d1Called = true;
          throw new Error("d1 should not run");
        },
      },
    },
    30,
    "test",
  );
  assert.equal(d1Called, false);
  assert.deepEqual(creators, validArtifact.creators);
});

test("resolvePickupCreatorsWithFallback は missing 時に D1 fallback する", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    applyActiveMigrations(sqlite);
    sqlite.prepare(`INSERT INTO "user" (id) VALUES (?)`).run("auth-user");
    sqlite
      .prepare(`INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)`)
      .run("creator", "Creator", "approved");
    sqlite
      .prepare(
        `INSERT INTO videos (
           id, title, youtube_video_id, creator_display_name, creator_x_user_id,
           submitted_by_user_id, visibility_status, scheduled_time, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "video-1",
        "Public Video",
        "youtube-1",
        "Creator",
        "creator",
        "auth-user",
        "public",
        100,
        123,
      );

    const creators = await resolvePickupCreatorsWithFallback(
      {
        R2: { async get() { return null; } },
        DB: d1FromSqlite(sqlite),
      },
      60,
      "test",
    );
    assert.equal(creators.length, 1);
    assert.equal(creators[0].id, "creator");
    assert.equal(creators[0].video_count, 1);
  } finally {
    sqlite.close();
  }
});
