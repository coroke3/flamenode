import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GA4_TRENDING_OUTPUT_KEY,
  syncGa4Trending,
} from "./sync.ts";

function recentPayload() {
  return JSON.stringify({
    generated_at: 1_700_000_000,
    total: 1,
    items: [
      {
        id: "video-a",
        title: "A",
        youtube_video_id: "yt-a",
        display_name: "creator",
        scheduled_time: 1_700_000_000,
        status: "public",
      },
    ],
  });
}

function recentDb(items = JSON.parse(recentPayload()).items) {
  let reads = 0;
  return {
    get reads() { return reads; },
    prepare(sql) {
      reads += 1;
      assert.match(sql, /FROM videos AS v/);
      return {
        bind(limit) {
          assert.equal(limit, 5001);
          return { async all() {
            return { results: items.map((item) => ({
              ...item,
              creator_x_user_id: item.creator_x_user_id ?? null,
              icon_url: item.icon_url ?? null,
              primary_event_id: item.primary_event_id ?? null,
              primary_event_title: item.primary_event_title ?? null,
            })) };
          } };
        },
      };
    },
  };
}

test("syncGa4Trending skips when GA4_SYNC_ENABLED is not 1", async () => {
  let putCalls = 0;
  let logLine = "";
  const originalLog = console.log;
  console.log = (value) => {
    logLine = String(value);
  };
  const env = {
    GA4_SYNC_ENABLED: "0",
    R2: {
      get() {
        throw new Error("unexpected R2 get");
      },
      put() {
        putCalls += 1;
        throw new Error("unexpected R2 put");
      },
    },
    KV: { get() { throw new Error("unexpected KV get"); } },
  };

  try {
    const result = await syncGa4Trending(env);
    assert.equal(result.skipped, 1);
    assert.equal(putCalls, 0);
    const event = JSON.parse(logLine);
    assert.equal(event.job, "ga4-trending-sync");
    assert.equal(event.result, "skipped");
    assert.equal(event.enabled, false);
  } finally {
    console.log = originalLog;
  }
});

test("syncGa4Trending fails closed with config_missing when secrets are absent", async () => {
  let putCalls = 0;
  let logLine = "";
  const originalLog = console.log;
  console.log = (value) => {
    logLine = String(value);
  };
  const env = {
    DB: recentDb(),
    GA4_SYNC_ENABLED: "1",
    R2: {
      get() {
        throw new Error("unexpected R2 get");
      },
      put() {
        putCalls += 1;
        throw new Error("unexpected R2 put");
      },
    },
  };

  try {
    const result = await syncGa4Trending(env);
    assert.equal(result.failed, 1);
    assert.equal(putCalls, 0);
    const event = JSON.parse(logLine);
    assert.equal(event.job, "ga4-trending-sync");
    assert.equal(event.result, "failed");
    assert.equal(event.error_name, "config_missing");
    assert.equal(event.r2_written, false);
    assert.equal(event.GA4_SERVICE_ACCOUNT_PRIVATE_KEY, undefined);
  } finally {
    console.log = originalLog;
  }
});

function enabledGa4Env(overrides = {}) {
  return {
    DB: recentDb(),
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "test-private-key",
    KV: {
      async get() {
        return null;
      },
    },
    ...overrides,
  };
}

test("syncGa4Trending fails closed on D1 source failure", async () => {
  let writes = 0;
  const env = enabledGa4Env({
    DB: { prepare() { throw Error("d1_recent_unavailable"); } },
    R2: { get() { throw Error("unexpected R2 read"); }, put() { writes += 1; } },
  });
  await assert.rejects(() => syncGa4Trending(env), /d1_recent_unavailable/);
  assert.equal(writes, 0);
});

test("MIG-0517 T03: zero public D1 rows publish an empty R2 ranking without GA4", async () => {
  const db = recentDb([]);
  let writes = 0;
  let published = null;
  const env = enabledGa4Env({
    DB: db,
    R2: {
      get() { throw Error("unexpected R2 read"); },
      put(key, body) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        writes += 1;
        published = JSON.parse(String(body));
      },
    },
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error("unexpected GA4 request"); };
  try {
    const result = await syncGa4Trending(env);
    assert.deepEqual([result.processed, result.failed, result.skipped], [0, 0, 0]);
    assert.equal(result.external_api_calls, 0);
    assert.equal(db.reads, 1);
    assert.equal(writes, 1);
    assert.deepEqual(published.items, []);
    assert.equal(published.schema_version, 1);
    assert.ok(Number.isFinite(published.generated_at));
    assert.equal(published.source, "ga4");
  } finally { globalThis.fetch = oldFetch; }
});

test("syncGa4Trending does not put when AbortSignal is already aborted", async () => {
  let putCalls = 0;
  const env = enabledGa4Env({
    R2: {
      get() {
        throw new Error("R2 get should not run after abort");
      },
      put() {
        putCalls += 1;
      },
    },
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => syncGa4Trending(env, controller.signal),
    (error) => error?.name === "AbortError" || /abort/i.test(String(error)),
  );
  assert.equal(putCalls, 0);
});

test("syncGa4Trending fail-closed: does not put trending.json on GA failure", async () => {
  let putCalls = 0;
  const env = {
    DB: recentDb(),
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "test-private-key",
    R2: {
      get() { throw Error("unexpected R2 recent read"); },
      put(key) {
        putCalls += 1;
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
      },
    },
    KV: {
      async get() {
        return null;
      },
    },
  };

  await assert.rejects(
    () => syncGa4Trending(env),
    /ga4_service_account_config_missing|ga4_oauth|ga4_report|invalid/i,
  );
  assert.equal(putCalls, 0);
});

test("syncGa4Trending puts empty items when GA returns no matching views", async () => {
  let putBody = "";
  let logLine = "";
  const originalLog = console.log;
  console.log = (value) => {
    logLine = String(value);
  };
  const env = {
    DB: recentDb(),
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "test-private-key",
    R2: {
      get(key) {
        if (key === GA4_TRENDING_OUTPUT_KEY) {
          return null;
        }
        return null;
      },
      put(key, body, options) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        putBody = String(body);
        assert.equal(
          options?.httpMetadata?.contentType,
          "application/json; charset=utf-8",
        );
        assert.equal(
          options?.httpMetadata?.cacheControl,
          "public, max-age=300, stale-while-revalidate=3600",
        );
      },
    },
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("analyticsdata.googleapis.com")) {
      return new Response(
        JSON.stringify({
          dimensionHeaders: [
            { name: "dateRange" },
            { name: "customEvent:video_id" },
          ],
          metricHeaders: [{ name: "eventCount" }],
          rowCount: 0,
          rows: [],
          propertyQuota: {
            tokensPerHour: { consumed: 1, remaining: 19999 },
            tokensPerDay: { consumed: 2, remaining: 39998 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const result = await syncGa4Trending(env);
    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0);
    const payload = JSON.parse(putBody);
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.source, "ga4");
    assert.deepEqual(payload.ranking_rule, [
      "views_2d_desc",
      "views_5d_desc",
      "views_7d_desc",
      "views_30d_desc",
      "video_id_asc",
    ]);
    assert.ok(payload.windows?.views_2d?.start_date);
    assert.ok(payload.windows?.views_2d?.end_date);
    assert.ok(Number.isFinite(payload.generated_at));
    assert.ok(Array.isArray(payload.items));
    assert.equal(payload.items.length, 0);
    const event = JSON.parse(logLine);
    assert.equal(event.result, "ok");
    assert.equal(event.quota_tokens_per_hour_remaining, 19999);
    assert.equal(event.quota_tokens_per_day_remaining, 39998);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("syncGa4Trending preserves existing trending when GA returns empty periods", async () => {
  let putCalls = 0;
  const existingTrending = JSON.stringify({
    schema_version: 1,
    generated_at: 1_699_000_000,
    source: "ga4",
    ranking_rule: ["views_2d_desc"],
    windows: {
      views_2d: { start_date: "2026-07-30", end_date: "2026-07-31" },
      views_5d: { start_date: "2026-07-27", end_date: "2026-07-31" },
      views_7d: { start_date: "2026-07-25", end_date: "2026-07-31" },
      views_30d: { start_date: "2026-07-02", end_date: "2026-07-31" },
    },
    items: [{ id: "video-a", title: "A", rank: 1, views_2d: 10, views_5d: 20, views_7d: 30, views_30d: 40 }],
  });
  const env = {
    DB: recentDb(),
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "test-private-key",
    R2: {
      get(key) {
        if (key === GA4_TRENDING_OUTPUT_KEY) {
          return {
            async text() {
              return existingTrending;
            },
          };
        }
        return null;
      },
      put() {
        putCalls += 1;
      },
    },
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("analyticsdata.googleapis.com")) {
      return new Response(
        JSON.stringify({
          dimensionHeaders: [
            { name: "dateRange" },
            { name: "customEvent:video_id" },
          ],
          metricHeaders: [{ name: "eventCount" }],
          rowCount: 0,
          rows: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    await assert.rejects(
      () => syncGa4Trending(env),
      /ga4_empty_report_preserving_existing/,
    );
    assert.equal(putCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: invalid D1 result cannot silently skip GA4 or overwrite R2", async () => {
  let writes = 0;
  const env = enabledGa4Env({
    DB: {
      prepare() {
        return { bind() { return { async all() { return {}; } }; } };
      },
    },
    R2: { get() { throw Error("unexpected R2 read"); }, put() { writes += 1; } },
  });
  await assert.rejects(() => syncGa4Trending(env), /ga4_recent_d1_invalid_result/);
  assert.equal(writes, 0);
});

test("MIG-0517: over-1MiB ASCII and UTF-8 ranking preserve last-good R2 artifact", async () => {
  let writes = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes("analyticsdata.googleapis.com")) {
      throw Error("unexpected request: " + url);
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "video-a" }],
        metricValues: [{ value: "1" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const token = JSON.stringify({
    access_token: "cached-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  try {
    // The second title is shorter than 1 MiB in JS string length but
    // exceeds the wire limit in UTF-8 bytes.
    for (const title of ["A".repeat(1_048_576), "界".repeat(400_000)]) {
      const env = enabledGa4Env({
        DB: recentDb([{
          id: "video-a", title, youtube_video_id: "yt-a",
          display_name: "Creator", scheduled_time: 1_700_000_000,
        }]),
        KV: { async get() { return token; } },
        R2: {
          get() { throw Error("unexpected R2 read"); },
          put() { writes += 1; },
        },
      });
      await assert.rejects(
        () => syncGa4Trending(env),
        /ga4_trending_output_exceeds_size_limit/,
      );
    }
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: R2 commit point after cancellation is reported as written, not failed", async () => {
  const controller = new AbortController();
  const writes = [];
  const logLines = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  console.log = (line) => { logLines.push(String(line)); };
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw new Error("unexpected GA4 request: " + String(input));
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "video-a" }],
        metricValues: [{ value: "3" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = enabledGa4Env({
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
    R2: {
      get() { throw new Error("unexpected old ranking read"); },
      async put(key, body) {
        writes.push({ key, body: JSON.parse(String(body)) });
        // R2 PUT completed, but caller's guard expires at the same boundary.
        controller.abort();
      },
    },
  });

  try {
    const result = await syncGa4Trending(env, controller.signal);
    assert.equal(result.failed, 0);
    assert.equal(result.processed, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, GA4_TRENDING_OUTPUT_KEY);
    assert.equal(writes[0].body.items[0].id, "video-a");
    const lastEvent = JSON.parse(logLines.at(-1));
    assert.equal(lastEvent.result, "ok");
    assert.equal(lastEvent.r2_written, true);
    assert.equal(controller.signal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});


test("MIG-0517: R2 PUT rejection remains a real sync failure with no success log", async () => {
  let writes = 0;
  const events = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  console.log = (line) => { events.push(JSON.parse(String(line))); };
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw new Error("unexpected GA4 request");
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "video-a" }],
        metricValues: [{ value: "2" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = enabledGa4Env({
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
    R2: {
      get() { throw new Error("unexpected old ranking read"); },
      async put() {
        writes += 1;
        throw new Error("ga4_r2_put_unavailable");
      },
    },
  });
  try {
    await assert.rejects(
      () => syncGa4Trending(env),
      /ga4_r2_put_unavailable/,
    );
    assert.equal(writes, 1);
    const lastEvent = events.at(-1);
    assert.equal(lastEvent.result, "failed");
    assert.equal(lastEvent.r2_written, false);
    assert.ok(events.every((event) => event.result !== "ok"));
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});


test("MIG-0517: GA4 orphan rows do not erase existing public rankings", async () => {
  const prior = JSON.stringify({
    schema_version: 1,
    generated_at: 1_700_000_000,
    items: [{ id: "video-a", title: "A", rank: 1, views_2d: 0, views_5d: 0, views_7d: 0, views_30d: 2 }],
  });
  const token = JSON.stringify({
    access_token: "cached-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  let puts = 0;
  let reads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw Error("unexpected request");
    }
    // GA4 can return views for a removed/private video whose id is absent
    // from the canonical D1 public allow-list.
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "orphan-video" }],
        metricValues: [{ value: "9" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = enabledGa4Env({
    KV: { async get() { return token; } },
    R2: {
      async get(key) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        reads += 1;
        return { size: Buffer.byteLength(prior), async text() { return prior; } };
      },
      async put() { puts += 1; },
    },
  });
  try {
    await assert.rejects(
      () => syncGa4Trending(env),
      /ga4_empty_report_preserving_existing/,
    );
    assert.equal(reads, 1);
    assert.equal(puts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MIG-0517: GA4 orphan rows may publish an empty ranking on first generation", async () => {
  const token = JSON.stringify({
    access_token: "cached-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  let puts = 0;
  let output = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw Error("unexpected request");
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "orphan-video" }],
        metricValues: [{ value: "9" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = enabledGa4Env({
    KV: { async get() { return token; } },
    R2: {
      async get(key) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        return null;
      },
      async put(key, body) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        puts += 1;
        output = JSON.parse(String(body));
      },
    },
  });
  try {
    const result = await syncGa4Trending(env);
    assert.deepEqual([result.failed, result.processed], [0, 0]);
    assert.equal(puts, 1);
    assert.deepEqual(output.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: generated_at and GA4 windows share the exact UTC date", async () => {
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  const atBoundary = Date.parse("2031-03-01T23:59:59.999Z");
  let payload = null;
  Date.now = () => atBoundary;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw new Error("unexpected request");
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 0,
      rows: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = enabledGa4Env({
    KV: { async get() {
      return JSON.stringify({
        access_token: "cached-token",
        expires_at: Math.floor(atBoundary / 1000) + 3600,
      });
    } },
    R2: {
      async get() { return null; },
      async put(key, body) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        payload = JSON.parse(String(body));
      },
    },
  });
  try {
    const result = await syncGa4Trending(env);
    assert.equal(result.failed, 0);
    assert.ok(payload);
    assert.equal(payload.generated_at, Math.floor(atBoundary / 1000));
    assert.deepEqual(payload.windows, {
      views_2d: { start_date: "2031-02-28", end_date: "2031-03-01" },
      views_5d: { start_date: "2031-02-25", end_date: "2031-03-01" },
      views_7d: { start_date: "2031-02-23", end_date: "2031-03-01" },
      views_30d: { start_date: "2031-01-31", end_date: "2031-03-01" },
    });
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: now-private R2 rows must not survive GA4 orphan-only refresh", async () => {
  const token = JSON.stringify({
    access_token: "cached-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw new Error("unexpected request");
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "removed-video" }],
        metricValues: [{ value: "7" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    // Both an entirely revoked ranking and a partially revoked ranking must
    // be replaced, rather than retaining private IDs through stale R2.
    for (const ids of [
      ["removed-video"],
      ["video-a", "removed-video"],
    ]) {
      let puts = 0;
      let written = null;
      let gets = 0;
      const previous = JSON.stringify({
        schema_version: 1,
        generated_at: 1_700_000_000,
        items: ids.map((id) => ({ id, status: "public" })),
      });
      const env = enabledGa4Env({
        KV: { async get() { return token; } },
        R2: {
          async get(key) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            gets += 1;
            return { size: Buffer.byteLength(previous), async text() { return previous; } };
          },
          async put(key, body) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            puts += 1;
            written = JSON.parse(String(body));
          },
        },
      });
      const outcome = await syncGa4Trending(env);
      assert.equal(outcome.failed, 0);
      assert.equal(gets, 1);
      assert.equal(puts, 1);
      assert.deepEqual(written.items, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: oversized existing R2 body cannot bypass cap via absent or wrong metadata", async () => {
  const token = JSON.stringify({
    access_token: "cached-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) {
      throw new Error("unexpected request");
    }
    return new Response(JSON.stringify({
      dimensionHeaders: [
        { name: "dateRange" },
        { name: "customEvent:video_id" },
      ],
      metricHeaders: [{ name: "eventCount" }],
      rowCount: 1,
      rows: [{
        dimensionValues: [{ value: "last_30" }, { value: "orphan-video" }],
        metricValues: [{ value: "9" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    for (const [title, size] of [
      ["A".repeat(1_048_576), undefined],
      ["界".repeat(400_000), 100],
    ]) {
      // The previous ranking's ID is currently public. Without a wire-size
      // guard on the actual R2 text, it would be preserved even though a
      // public trending consumer rejects this >1MiB JSON object.
      const stale = JSON.stringify({
        schema_version: 1,
        items: [{ id: "video-a", status: "public", title }],
      });
      assert.ok(Buffer.byteLength(stale, "utf8") > 1_048_576);
      let reads = 0;
      let puts = 0;
      let output;
      const env = enabledGa4Env({
        KV: { async get() { return token; } },
        R2: {
          async get(key) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            reads += 1;
            return {
              ...(size === undefined ? {} : { size }),
              async text() { return stale; },
            };
          },
          async put(key, body) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            puts += 1;
            output = JSON.parse(String(body));
          },
        },
      });
      const result = await syncGa4Trending(env);
      assert.equal(result.failed, 0);
      assert.equal(reads, 1);
      assert.equal(puts, 1);
      assert.deepEqual(output.items, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("MIG-0517: invalid old R2 schema or reader-rejected items cannot block empty refresh", async () => {
  const token = JSON.stringify({ access_token: "cached-token", expires_at: Math.floor(Date.now() / 1000) + 3600 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("analyticsdata.googleapis.com")) throw Error("unexpected request");
    return new Response(JSON.stringify({
      dimensionHeaders: [{ name: "dateRange" }, { name: "customEvent:video_id" }],
      metricHeaders: [{ name: "eventCount" }], rowCount: 1,
      rows: [{ dimensionValues: [{ value: "last_30" }, { value: "orphan-video" }], metricValues: [{ value: "9" }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const validItem = {
      id: "video-a", title: "A", status: "public", rank: 1,
      views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4,
    };
    for (const previous of [
      { schema_version: 99, generated_at: 1_700_000_000, items: [validItem] },
      { schema_version: 1, items: [validItem] },
      { schema_version: 1, generated_at: "not-a-time", items: [validItem] },
      { schema_version: 1, generated_at: 1_700_000_000, items: [{ ...validItem, title: undefined }] },
      { schema_version: 1, generated_at: 1_700_000_000, items: [{ ...validItem, views_2d: undefined }] },
      { schema_version: 1, generated_at: 1_700_000_000, items: [{ ...validItem, video_id: "different-id" }] },
    ]) {
      const prior = JSON.stringify(previous);
      let reads = 0;
      let puts = 0;
      let output = null;
      const env = enabledGa4Env({
        KV: { async get() { return token; } },
        R2: {
          async get(key) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            reads++;
            return { size: Buffer.byteLength(prior), async text() { return prior; } };
          },
          async put(key, body) {
            assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
            puts++;
            output = JSON.parse(String(body));
          },
        },
      });
      const result = await syncGa4Trending(env);
      assert.equal(result.failed, 0);
      assert.equal(reads, 1);
      assert.equal(puts, 1);
      assert.equal(output.schema_version, 1);
      assert.ok(Number.isFinite(output.generated_at));
      assert.deepEqual(output.items, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
