import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  decidePublicBuild,
  checkAndTriggerPublicBuild,
  MAX_DATA_BUILDS_PER_DAY,
  MIN_BUILD_INTERVAL_MS,
} from "./publicBuildTrigger.ts";

function createTestDb(initialState = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE public_build_state (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      requested_at INTEGER NOT NULL DEFAULT 0,
      last_hook_at INTEGER NOT NULL DEFAULT 0,
      hooks_day TEXT NOT NULL DEFAULT '',
      hooks_today INTEGER NOT NULL DEFAULT 0
    );
  `);

  const requestedAt = initialState.requested_at ?? 0;
  const lastHookAt = initialState.last_hook_at ?? 0;
  const hooksDay = initialState.hooks_day ?? "";
  const hooksToday = initialState.hooks_today ?? 0;

  db.prepare(`
    INSERT INTO public_build_state (id, requested_at, last_hook_at, hooks_day, hooks_today)
    VALUES (1, ?, ?, ?, ?)
  `).run(requestedAt, lastHookAt, hooksDay, hooksToday);

  // Wrap in D1-like interface
  return {
    prepare(query) {
      const stmt = db.prepare(query);
      return {
        bind(...values) {
          return {
            async first() {
              return stmt.get(...values) ?? null;
            },
            async run() {
              const info = stmt.run(...values);
              return {
                meta: { changes: Number(info.changes) },
                changes: Number(info.changes),
              };
            },
          };
        },
      };
    },
    raw: db,
  };
}

test("T01: 前回の hook の後に変更なし -> skip, fetch 0回", async () => {
  const now = 1700000000000;
  // requested_at <= last_hook_at
  const decision = decidePublicBuild({
    requestedAt: 1000,
    lastHookAt: 1000,
    hooksDay: "2026-10-17",
    hooksToday: 5,
    now,
  });
  assert.equal(decision, "skip");

  let fetchCalls = 0;
  const d1 = createTestDb({ requested_at: 1000, last_hook_at: 1000 });
  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://api.cloudflare.com/deploy-hook",
    },
    {
      now,
      fetchFn: async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.decision, "skip");
  assert.equal(result.triggered, false);
  assert.equal(result.d1_changes, 0);
  assert.equal(fetchCalls, 0);
});

test("T02: 変更あり、前回から MIN_BUILD_INTERVAL_MS 未満 -> skip", async () => {
  const lastHookAt = 1700000000000;
  const requestedAt = lastHookAt + 10000; // 変更あり
  const now = lastHookAt + MIN_BUILD_INTERVAL_MS - 1000; // 7分59秒経過 (未達)

  const decision = decidePublicBuild({
    requestedAt,
    lastHookAt,
    hooksDay: "2026-10-17",
    hooksToday: 5,
    now,
  });
  assert.equal(decision, "skip");

  let fetchCalls = 0;
  const d1 = createTestDb({ requested_at: requestedAt, last_hook_at: lastHookAt });
  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://api.cloudflare.com/deploy-hook",
    },
    {
      now,
      fetchFn: async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.decision, "skip");
  assert.equal(result.triggered, false);
  assert.equal(fetchCalls, 0);
});

test("T03: 変更あり、間隔を満たす -> trigger, fetch 1回, last_hook_at が更新", async () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const lastHookAt = now - MIN_BUILD_INTERVAL_MS - 5000; // 8分05秒前
  const requestedAt = lastHookAt + 10000;

  const decision = decidePublicBuild({
    requestedAt,
    lastHookAt,
    hooksDay: "2026-10-17",
    hooksToday: 5,
    now,
  });
  assert.equal(decision, "trigger");

  let fetchCalls = 0;
  const d1 = createTestDb({
    requested_at: requestedAt,
    last_hook_at: lastHookAt,
    hooks_day: "2026-10-17",
    hooks_today: 5,
  });

  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://api.cloudflare.com/deploy-hook",
    },
    {
      now,
      fetchFn: async (url, init) => {
        fetchCalls++;
        assert.equal(url, "https://api.cloudflare.com/deploy-hook");
        assert.equal(init?.method, "POST");
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.decision, "trigger");
  assert.equal(result.triggered, true);
  assert.equal(result.d1_changes, 1);
  assert.equal(fetchCalls, 1);

  // Verify DB state updated
  const updated = d1.raw.prepare("SELECT * FROM public_build_state WHERE id = 1").get();
  assert.equal(Number(updated.last_hook_at), now);
  assert.equal(Number(updated.hooks_today), 6);
});

test("T04: 同じ日に MAX_DATA_BUILDS_PER_DAY 回呼んだ後 -> skip", async () => {
  const now = Date.parse("2026-10-17T15:00:00Z");
  const lastHookAt = now - MIN_BUILD_INTERVAL_MS - 10000;
  const requestedAt = now - 5000;

  const decision = decidePublicBuild({
    requestedAt,
    lastHookAt,
    hooksDay: "2026-10-17",
    hooksToday: MAX_DATA_BUILDS_PER_DAY,
    now,
  });
  assert.equal(decision, "skip");

  let fetchCalls = 0;
  const d1 = createTestDb({
    requested_at: requestedAt,
    last_hook_at: lastHookAt,
    hooks_day: "2026-10-17",
    hooks_today: MAX_DATA_BUILDS_PER_DAY,
  });

  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://api.cloudflare.com/deploy-hook",
    },
    {
      now,
      fetchFn: async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.decision, "skip");
  assert.equal(result.triggered, false);
  assert.equal(fetchCalls, 0);
});

test("T05: UTC の日付が変わった -> 回数が 0 から数え直される (初回で 1)", async () => {
  const now = Date.parse("2026-10-18T00:05:00Z"); // 翌日
  const lastHookAt = now - MIN_BUILD_INTERVAL_MS - 10000;
  const requestedAt = now - 5000;

  const decision = decidePublicBuild({
    requestedAt,
    lastHookAt,
    hooksDay: "2026-10-17", // 前日
    hooksToday: MAX_DATA_BUILDS_PER_DAY, // 前日は上限到達
    now,
  });
  assert.equal(decision, "trigger");

  const d1 = createTestDb({
    requested_at: requestedAt,
    last_hook_at: lastHookAt,
    hooks_day: "2026-10-17",
    hooks_today: MAX_DATA_BUILDS_PER_DAY,
  });

  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://api.cloudflare.com/deploy-hook",
    },
    {
      now,
      fetchFn: async () => new Response(null, { status: 200 }),
    },
  );

  assert.equal(result.decision, "trigger");
  assert.equal(result.triggered, true);

  const updated = d1.raw.prepare("SELECT * FROM public_build_state WHERE id = 1").get();
  assert.equal(updated.hooks_day, "2026-10-18");
  assert.equal(Number(updated.hooks_today), 1);
});

test("T06: 2つの invocation が同時に trigger と判断 -> 条件付き UPDATE により fetch は1回だけ", async () => {
  const lastHookAt = 1700000000000;
  const requestedAt = lastHookAt + 10000;
  const now = lastHookAt + MIN_BUILD_INTERVAL_MS + 5000;

  const d1 = createTestDb({
    requested_at: requestedAt,
    last_hook_at: lastHookAt,
    hooks_day: "2026-10-17",
    hooks_today: 0,
  });

  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls++;
    return new Response(null, { status: 200 });
  };

  // Run two checkAndTriggerPublicBuild concurrently
  const [res1, res2] = await Promise.all([
    checkAndTriggerPublicBuild(
      { DB: d1, PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://example.com/hook" },
      { now, fetchFn },
    ),
    checkAndTriggerPublicBuild(
      { DB: d1, PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://example.com/hook" },
      { now, fetchFn },
    ),
  ]);

  // Exactly one should succeed in updating D1 and triggering fetch
  const totalTriggered = (res1.triggered ? 1 : 0) + (res2.triggered ? 1 : 0);
  assert.equal(totalTriggered, 1);
  assert.equal(fetchCalls, 1);
});

test("T07: hook の URL が未設定 -> 何もしない、例外なし", async () => {
  const lastHookAt = 1700000000000;
  const requestedAt = lastHookAt + 10000;
  const now = lastHookAt + MIN_BUILD_INTERVAL_MS + 5000;

  const d1 = createTestDb({
    requested_at: requestedAt,
    last_hook_at: lastHookAt,
  });

  let fetchCalls = 0;
  const result = await checkAndTriggerPublicBuild(
    {
      DB: d1,
      PUBLIC_BUILD_DEPLOY_HOOK_URL: undefined, // 未設定
    },
    {
      now,
      fetchFn: async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      },
    },
  );

  assert.equal(result.decision, "trigger");
  assert.equal(result.triggered, false);
  assert.equal(result.d1_changes, 1);
  assert.equal(fetchCalls, 0);
});
