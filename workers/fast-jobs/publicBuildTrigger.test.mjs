import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  decidePublicBuild,
  checkAndTriggerPublicBuild,
  MAX_DATA_BUILDS_PER_DAY,
  MIN_BUILD_INTERVAL_MS,
} from "./publicBuildTrigger.ts";

const MIGRATION_SQL = readFileSync(
  new URL("../../migrations/0065_public_build_state.sql", import.meta.url),
  "utf8",
);

/** The real 0065 migration (table + seed row), then the test's starting state. */
function createTestDb(initialState = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION_SQL);
  const statements = [];

  const requestedAt = initialState.requested_at ?? 0;
  const lastHookAt = initialState.last_hook_at ?? 0;
  const hooksDay = initialState.hooks_day ?? "";
  const hooksToday = initialState.hooks_today ?? 0;

  db.prepare(`
    UPDATE public_build_state
    SET requested_at = ?, last_hook_at = ?, hooks_day = ?, hooks_today = ?
    WHERE id = 1
  `).run(requestedAt, lastHookAt, hooksDay, hooksToday);

  // Wrap in D1-like interface
  return {
    prepare(query) {
      statements.push(query);
      const stmt = db.prepare(query);
      return {
        bind(...values) {
          return {
            async first() {
              return stmt.get(...values) ?? null;
            },
            // withD1Budget (workers/shared/d1Budget.ts) executes first() through all().
            async all() {
              return { results: stmt.all(...values), meta: {} };
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
    statements,
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

  assert.equal(result.decision, "skip");
  assert.equal(result.triggered, false);
  assert.equal(result.d1_changes, 0);
  assert.equal(fetchCalls, 0);
  // "何もしない": no D1 statement at all, and the pending request stays pending.
  assert.equal(d1.statements.length, 0);
  const row = d1.raw.prepare("SELECT * FROM public_build_state WHERE id = 1").get();
  assert.equal(Number(row.last_hook_at), lastHookAt);
  assert.equal(Number(row.requested_at), requestedAt);
});

test("migration seeds exactly one row with id = 1 and rejects a second row", () => {
  const d1 = createTestDb();
  const rows = d1.raw.prepare("SELECT * FROM public_build_state").all();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].id), 1);
  assert.throws(() => d1.raw.prepare("INSERT INTO public_build_state (id) VALUES (2)").run(), /CHECK/);
});

for (const [label, fetchFn] of [
  ["non-2xx", async () => new Response("no", { status: 500 })],
  ["network error", async () => { throw new TypeError("network connection lost"); }],
]) {
  test(`hook failure (${label}) restores last_hook_at so the next Cron retries, URL never logged`, async () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const lastHookAt = now - MIN_BUILD_INTERVAL_MS - 5000;
    const requestedAt = lastHookAt + 10000;
    const secretUrl = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/SECRET-TOKEN";
    const d1 = createTestDb({ requested_at: requestedAt, last_hook_at: lastHookAt, hooks_day: "2026-10-17", hooks_today: 3 });
    const logged = [];
    const original = { warn: console.warn, error: console.error, log: console.log };
    console.warn = console.error = console.log = (...args) => logged.push(args.map(String).join(" "));
    let result;
    try {
      result = await checkAndTriggerPublicBuild({ DB: d1, PUBLIC_BUILD_DEPLOY_HOOK_URL: secretUrl }, { now, fetchFn });
    } finally {
      Object.assign(console, original);
    }
    assert.equal(result.triggered, false);
    assert.equal(result.hookFailed, true);
    const row = d1.raw.prepare("SELECT * FROM public_build_state WHERE id = 1").get();
    assert.equal(Number(row.last_hook_at), lastHookAt, "claim must be given back");
    assert.equal(Number(row.hooks_today), 4, "a failed attempt still counts toward the daily cap");
    assert.ok(logged.length > 0);
    assert.ok(logged.every((line) => !line.includes("SECRET-TOKEN") && !line.includes(secretUrl)));

    // The next Cron (one hour later) retries and succeeds.
    let calls = 0;
    const retry = await checkAndTriggerPublicBuild(
      { DB: d1, PUBLIC_BUILD_DEPLOY_HOOK_URL: secretUrl },
      { now: now + 3_600_000, fetchFn: async () => { calls += 1; return new Response(null, { status: 200 }); } },
    );
    assert.equal(retry.triggered, true);
    assert.equal(calls, 1);
  });
}

test("a change recorded during the build is picked up by the next run (requested_at > last_hook_at)", async () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const d1 = createTestDb({ requested_at: now - 60_000, last_hook_at: now - MIN_BUILD_INTERVAL_MS - 1 });
  const ok = async () => new Response(null, { status: 200 });
  const env = { DB: d1, PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://example.invalid/hook" };
  assert.equal((await checkAndTriggerPublicBuild(env, { now, fetchFn: ok })).triggered, true);
  // S3 records another change after the hook.
  d1.raw.prepare("UPDATE public_build_state SET requested_at = ? WHERE id = 1").run(now + 1000);
  assert.equal((await checkAndTriggerPublicBuild(env, { now: now + 60_000, fetchFn: ok })).decision, "skip", "debounced");
  assert.equal((await checkAndTriggerPublicBuild(env, { now: now + MIN_BUILD_INTERVAL_MS, fetchFn: ok })).triggered, true);
});

test("U04 wire: the hourly fast-jobs Cron runs the stage once, with at most 2 D1 statements on it", async () => {
  const { runFastJobs } = await import("./index.ts");
  const now = Date.now();
  const build = createTestDb({ requested_at: now - 1000, last_hook_at: now - MIN_BUILD_INTERVAL_MS - 10_000 });
  const env = {
    NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
    PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://example.invalid/hook",
    KV: { async get() { return null; }, async put() {}, async delete() {} },
    DB: {
      prepare(sql) {
        if (sql.includes("public_build_state")) return build.prepare(sql);
        const stub = {
          bind() { return stub; },
          async run() { return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; },
          async first() { return null; },
        };
        return stub;
      },
    },
  };
  const originalFetch = globalThis.fetch;
  const hookCalls = [];
  globalThis.fetch = async (url, init) => {
    hookCalls.push({ url: String(url), method: init?.method });
    return new Response(null, { status: 200 });
  };
  try {
    await runFastJobs(env, { scheduledTime: now, signal: new AbortController().signal });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(hookCalls, [{ url: "https://example.invalid/hook", method: "POST" }]);
  assert.ok(build.statements.length <= 2, `public_build_state statements: ${build.statements.length}`);
  const row = build.raw.prepare("SELECT * FROM public_build_state WHERE id = 1").get();
  assert.ok(Number(row.last_hook_at) >= now);
});

test("CPU: one stage run stays far below the 8ms Runtime B budget (local Node, mocks)", async () => {
  // Same method as scripts/migration-gateway.test.mjs: D1/fetch mocks resolve in a
  // microtask, fastest of 5 repeats per sample; this is local wall time, not workerd CPU.
  const row = { requested_at: 2, last_hook_at: 1, hooks_day: "2026-10-17", hooks_today: 3 };
  const db = {
    prepare() {
      return { bind() { return { async first() { return row; }, async run() { return { meta: { changes: 1 } }; } }; } };
    },
  };
  const env = { DB: db, PUBLIC_BUILD_DEPLOY_HOOK_URL: "https://example.invalid/hook" };
  const fetchFn = async () => new Response(null, { status: 200 });
  const samples = [];
  for (let i = 0; i < 200; i += 1) {
    let best = Infinity;
    for (let r = 0; r < 5; r += 1) {
      const start = performance.now();
      await checkAndTriggerPublicBuild(env, { now: Date.parse("2026-10-17T12:00:00Z") + i, fetchFn });
      best = Math.min(best, performance.now() - start);
    }
    samples.push(best);
  }
  samples.sort((a, b) => a - b);
  const p99 = samples[Math.floor(samples.length * 0.99) - 1];
  const max = samples.at(-1);
  console.log(`[MIG-0410 CPU] n=200 p50=${samples[100].toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`);
  assert.ok(max < 8, `max ${max}ms`);
});
