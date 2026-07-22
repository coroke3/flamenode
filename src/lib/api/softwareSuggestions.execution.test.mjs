import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";

const runningExecution = process.env.FLAMENODE_SOFTWARE_SUGGESTIONS_EXECUTION === "1";

if (!runningExecution) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_SOFTWARE_SUGGESTIONS_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  let currentDb;

  mock.module("@/lib/cloudflare", {
    namedExports: {
      async withDatabase(callback) {
        return callback(currentDb);
      },
    },
  });

  const { GET } = await import("../../../app/api/software/suggestions/route.ts");

  function createHarness() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} software_catalog (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        category TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_verified INTEGER NOT NULL DEFAULT 0
      );
      ${["CREATE", "TABLE"].join(" ")} software_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        software_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL
      );
    `);
    const insertSoftware = sqlite.prepare(
      "INSERT INTO software_catalog (id, name, normalized_name, category, usage_count, is_active, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (let index = 0; index < 60; index += 1) {
      insertSoftware.run(
        `active-${String(index).padStart(2, "0")}`,
        `Active ${String(index).padStart(2, "0")}`,
        `active${String(index).padStart(2, "0")}`,
        "video",
        100 - index,
        1,
        index % 2,
      );
    }
    insertSoftware.run("inactive-1", "Hidden Editor", "hiddeneditor", "video", 999, 0, 1);
    sqlite
      .prepare(
        "INSERT INTO software_aliases (id, software_id, alias, normalized_alias) VALUES (?, ?, ?, ?)",
      )
      .run("alias-inactive", "inactive-1", "Hidden", "hidden");

    const db = drizzle(async (query, params, method) => {
      const statement = sqlite.prepare(query);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      if (method === "get") {
        const row = statement.get(...params);
        return { rows: row ? Object.values(row) : undefined };
      }
      const rows = statement.all(...params).map((row) => Object.values(row));
      return { rows };
    });
    return { db, sqlite };
  }

  async function requestSuggestions(query = "") {
    const response = await GET(
      new Request(`https://example.test/api/software/suggestions${query}`),
    );
    assert.equal(response.status, 200);
    return response.json();
  }

  test("inactiveだけを指すaliasは0件で、内部のis_activeを返さない", async () => {
    const harness = createHarness();
    currentDb = harness.db;
    assert.deepEqual(await requestSuggestions("?q=hidden&limit=5"), []);

    const active = await requestSuggestions("?limit=1");
    assert.equal(active.length, 1);
    assert.deepEqual(Object.keys(active[0]).sort(), [
      "category",
      "id",
      "is_verified",
      "name",
      "usage_count",
    ]);
    assert.equal("is_active" in active[0], false);
    harness.sqlite.close();
  });

  test("limitの負数・0・NaN・上限超過をDB取得件数でも正規化する", async () => {
    const harness = createHarness();
    currentDb = harness.db;
    assert.equal((await requestSuggestions("?limit=-1")).length, 1);
    assert.equal((await requestSuggestions("?limit=0")).length, 20);
    assert.equal((await requestSuggestions("?limit=NaN")).length, 20);
    assert.equal((await requestSuggestions("?limit=51")).length, 50);
    assert.equal((await requestSuggestions("?limit=999")).length, 50);
    harness.sqlite.close();
  });
}
