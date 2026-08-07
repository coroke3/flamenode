import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildPickupCreatorsArtifactFromProjection,
  buildPickupCreatorsFromProjection,
  buildPublicUsersIndexItems,
  loadPublicCreatorProjectionSources,
  normalizePickupCreatorsArtifact,
  PICKUP_CREATORS_STORE_LIMIT,
} from "./publicCreatorProjection.ts";

const migrationsDir = fileURLToPath(new URL("../../../migrations/", import.meta.url));

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
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

function baseSources(overrides = {}) {
  return {
    registeredUsers: [],
    orphans: [],
    personalCounts: new Map(),
    collabCounts: new Map(),
    totalWorks: new Map(),
    updatedAts: new Map(),
    displayNames: new Map(),
    iconUrls: new Map(),
    ...overrides,
  };
}

test("buildPublicUsersIndexItems は sort_score と並び順を維持する", () => {
  const items = buildPublicUsersIndexItems(
    baseSources({
      registeredUsers: [
        {
          id: "alpha",
          x_name: "Alpha",
          icon_url: null,
          profile_text: null,
          youtube_channel_url: null,
        },
        {
          id: "beta",
          x_name: "Beta",
          icon_url: null,
          profile_text: null,
          youtube_channel_url: null,
        },
      ],
      personalCounts: new Map([
        ["alpha", 1],
        ["beta", 3],
      ]),
      collabCounts: new Map([["beta", 1]]),
      totalWorks: new Map([
        ["alpha", 1],
        ["beta", 4],
      ]),
      updatedAts: new Map([
        ["alpha", 10],
        ["beta", 20],
      ]),
    }),
    99,
  );

  assert.equal(items.length, 2);
  assert.equal(items[0].x_id, "beta");
  assert.equal(items[0].sort_score, 11);
  assert.equal(items[1].sort_score, 3);
});

test("buildPublicUsersIndexItems は作品なしでもプロフィールがあれば載せる", () => {
  const items = buildPublicUsersIndexItems(
    baseSources({
      registeredUsers: [
        {
          id: "profile-only",
          x_name: "Profile Only",
          icon_url: null,
          profile_text: "hello",
          youtube_channel_url: null,
        },
      ],
    }),
    50,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].total_works, 0);
  assert.equal(items[0].updated_at, 50);
});

test("buildPublicUsersIndexItems は未登録クリエイターと表示名フォールバックを維持する", () => {
  const items = buildPublicUsersIndexItems(
    baseSources({
      registeredUsers: [
        {
          id: "registered",
          x_name: null,
          icon_url: null,
          profile_text: null,
          youtube_channel_url: null,
        },
      ],
      orphans: [{ x_id: "orphan", personal_count: 2, updated_at: 77 }],
      personalCounts: new Map([["registered", 1]]),
      totalWorks: new Map([["registered", 1]]),
      displayNames: new Map([
        ["registered", "From Video"],
        ["orphan", "Orphan Name"],
      ]),
      iconUrls: new Map([["orphan", "https://example.com/orphan.png"]]),
      updatedAts: new Map([["registered", 30]]),
    }),
    1,
  );

  assert.equal(items.length, 2);
  const registered = items.find((row) => row.x_id === "registered");
  const orphan = items.find((row) => row.x_id === "orphan");
  assert.equal(registered?.x_name, "From Video");
  assert.equal(orphan?.x_name, "Orphan Name");
  assert.equal(orphan?.icon_url, "https://example.com/orphan.png");
  assert.equal(orphan?.collab_count, 0);
});

test("buildPickupCreatorsFromProjection は eligible だけを limit 件返す", () => {
  const creators = buildPickupCreatorsFromProjection(
    baseSources({
      registeredUsers: [
        { id: "solo", x_name: "Solo", icon_url: null, profile_text: null, youtube_channel_url: null },
        { id: "collab", x_name: "Collab", icon_url: null, profile_text: null, youtube_channel_url: null },
        { id: "empty", x_name: "Empty", icon_url: null, profile_text: null, youtube_channel_url: null },
      ],
      personalCounts: new Map([
        ["solo", 1],
        ["collab", 0],
        ["empty", 0],
      ]),
      collabCounts: new Map([
        ["collab", 2],
        ["empty", 1],
      ]),
    }),
    1,
  );

  assert.equal(creators.length, 1);
  assert.equal(creators[0].id, "collab");
  assert.equal(creators[0].collab_count, 2);
});

test("buildPickupCreatorsArtifactFromProjection は projection と deepEqual", () => {
  const sources = baseSources({
    registeredUsers: [
      { id: "solo", x_name: "Solo", icon_url: null, profile_text: null, youtube_channel_url: null },
      { id: "collab", x_name: "Collab", icon_url: "https://example.com/c.png", profile_text: null, youtube_channel_url: null },
    ],
    personalCounts: new Map([
      ["solo", 1],
      ["collab", 0],
    ]),
    collabCounts: new Map([["collab", 2]]),
  });
  const artifact = buildPickupCreatorsArtifactFromProjection(sources, 42);
  assert.deepEqual(artifact, {
    schema_version: 1,
    generated_at: 42,
    creators: buildPickupCreatorsFromProjection(sources, PICKUP_CREATORS_STORE_LIMIT),
  });
  assert.deepEqual(
    normalizePickupCreatorsArtifact(artifact),
    artifact,
  );
});

test("normalizePickupCreatorsArtifact は schema_version 不一致を拒否する", () => {
  assert.equal(
    normalizePickupCreatorsArtifact({
      schema_version: 2,
      generated_at: 1,
      creators: [],
    }),
    null,
  );
});

test("loadPublicCreatorProjectionSources は公開作品から集計する", async () => {
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

    const sources = await loadPublicCreatorProjectionSources(d1FromSqlite(sqlite), 999);
    const items = buildPublicUsersIndexItems(sources, 999);

    assert.equal(items.length, 1);
    assert.equal(items[0].x_id, "creator");
    assert.equal(items[0].personal_count, 1);
    assert.equal(items[0].updated_at, 123);
    assert.equal(buildPickupCreatorsFromProjection(sources, 10).length, 1);
  } finally {
    sqlite.close();
  }
});
