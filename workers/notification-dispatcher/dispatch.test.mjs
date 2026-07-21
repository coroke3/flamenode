import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  deliver,
  MAX_DISCORD_COOLDOWN_KV_WRITES_PER_RUN,
  MAX_DISCORD_DM_KV_WRITES_PER_RUN,
  MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN,
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
} from "./dispatch.ts";

function okJson(value = {}, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("notification dispatcher uses recipient_user_id and bounded lease-aware selection", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    },
  };
  const result = await processNotificationQueue(env, { limit: 999 });
  assert.deepEqual(result, {
    processed: 0,
    failed: 0,
    skipped: 0,
    external_api_calls: 0,
    d1_changes: 0,
    retry_count: 0,
    quota_stopped: false,
  });
  const sql = statements.join("\n");
  assert.match(sql, /recipient_user_id/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /dead_letter/);
  assert.match(sql, /COALESCE\(attempt_count, 0\)/);
  assert.match(sql, /lease_expires_at <= \?1/);
  assert.match(sql, /LIMIT \?3/);
  assert.equal(MAX_NOTIFICATION_BATCH, 6);
  assert.equal(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN, 12);
  assert.equal(MAX_DISCORD_DM_KV_WRITES_PER_RUN, 2);
  assert.equal(MAX_DISCORD_COOLDOWN_KV_WRITES_PER_RUN, 2);
});

test("deliver: generic notification types use Discord DM when bot token exists", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/users/@me/channels")) {
      return okJson({ id: "dm_channel" });
    }
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "announcement_broadcast",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      { DISCORD_BOT_TOKEN: "bot-token" },
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 2);
    assert.equal(
      JSON.parse(String(calls[0].init.body)).recipient_id,
      "123456789012345678",
    );
    assert.match(calls[1].url, /\/channels\/dm_channel\/messages$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: 共有cooldownのglobal KV読取は1 invocationで重複しない", async () => {
  const originalFetch = globalThis.fetch;
  const kvGets = [];
  const kv = {
    async get(key) {
      kvGets.push(key);
      return null;
    },
    async put() {},
  };
  globalThis.fetch = async (url) =>
    String(url).endsWith("/users/@me/channels")
      ? okJson({ id: "cooldown_read_channel" })
      : okJson();
  try {
    const ok = await deliver(
      {
        type: "announcement_broadcast",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "323456789012345678",
      },
      { KV: kv, DISCORD_BOT_TOKEN: "bot-token" },
    );
    assert.equal(ok, true);
    const cooldownGets = kvGets.filter((key) =>
      key.startsWith("external-api:discord:cooldown:"),
    );
    assert.equal(cooldownGets.length, 3);
    assert.equal(
      cooldownGets.filter((key) => key.endsWith(":global")).length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: 同一recipientのDM channelを再利用して2回目を1 requestにする", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/users/@me/channels")) {
      return okJson({ id: "reused_channel" });
    }
    return okJson();
  };
  const row = {
    type: "announcement_broadcast",
    payload_json: JSON.stringify({ content: "hello" }),
    discord_id: "223456789012345678",
  };
  try {
    assert.equal(await deliver(row, { DISCORD_BOT_TOKEN: "bot-token" }), true);
    assert.equal(await deliver(row, { DISCORD_BOT_TOKEN: "bot-token" }), true);
    assert.equal(calls.filter((url) => url.endsWith("/users/@me/channels")).length, 1);
    assert.equal(calls.filter((url) => url.endsWith("/messages")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: Discord 429はRetry-Afterを読んでinline retryしない", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ retry_after: 12.5, global: false }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "12.5",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset-after": "12.5",
      },
    });
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "",
      },
      { DISCORD_WEBHOOK_URL: "https://example.test/rate-limited" },
    );
    assert.equal(ok, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: discord_webhook without webhook URL does not fall back to DM", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      { DISCORD_BOT_TOKEN: "bot-token" },
    );
    assert.equal(ok, false);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deliver: discord_webhook uses webhook URL when configured", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return okJson();
  };
  try {
    const ok = await deliver(
      {
        type: "discord_webhook",
        payload_json: JSON.stringify({ content: "hello" }),
        discord_id: "123456789012345678",
      },
      {
        DISCORD_WEBHOOK_URL: "https://example.test/webhook",
        DISCORD_BOT_TOKEN: "bot-token",
      },
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/webhook");
    assert.equal(calls[0].init.body, JSON.stringify({ content: "hello" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Discord route cooldownはglobal cooldownも横断確認する", async () => {
  const source = await readFile(new URL("./dispatch.ts", import.meta.url), "utf8");
  assert.match(source, /DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global"/);
  assert.match(
    source,
    /activeCooldownUntil\(DISCORD_GLOBAL_COOLDOWN_KEY, now\)/,
  );
  assert.match(source, /x-ratelimit-global/);
  assert.match(source, /x-ratelimit-scope/);
  assert.match(source, /body\.global === true/);
});

test("Discord 429はinline retryせず次回実行へ繰り越す", async () => {
  const source = await readFile(new URL("./dispatch.ts", import.meta.url), "utf8");
  const failureSection = source.slice(
    source.indexOf("async function discordFailure"),
    source.indexOf("async function recoverExpiredLeases"),
  );
  assert.match(failureSection, /retryAfterSeconds/);
  assert.doesNotMatch(failureSection, /await delay/);
  assert.doesNotMatch(failureSection, /for \(let attempt/);
});

test("Discord 429 cooldownは匿名化KV keyで別isolate相当へ共有する", async () => {
  const originalFetch = globalThis.fetch;
  const cooldowns = globalThis.__flamenodeDiscordCooldowns;
  cooldowns?.clear();
  const values = new Map();
  const writes = [];
  const kv = {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value, options) {
      writes.push({ key, value, options });
      values.set(key, value);
    },
  };
  const webhook = "https://example.test/cross-isolate-rate-limit/secret-token";
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ retry_after: 30, global: false }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "30",
      },
    });
  };
  const row = {
    type: "discord_webhook",
    payload_json: JSON.stringify({ content: "hello" }),
    discord_id: "",
  };
  try {
    assert.equal(await deliver(row, { KV: kv, DISCORD_WEBHOOK_URL: webhook }), false);
    assert.equal(fetchCalls, 1);
    assert.equal(writes.length, 1);
    assert.match(writes[0].key, /^external-api:discord:cooldown:route:[0-9a-f]{64}$/);
    assert.doesNotMatch(writes[0].key, /secret-token|example\.test/);

    // isolate内Mapを失った状態でもKVの期限を読み、外部requestを抑止する。
    cooldowns?.clear();
    assert.equal(await deliver(row, { KV: kv, DISCORD_WEBHOOK_URL: webhook }), false);
    assert.equal(fetchCalls, 1);
  } finally {
    cooldowns?.clear();
    globalThis.fetch = originalFetch;
  }
});

function pendingWebhookRow(id) {
  return {
    id,
    recipient_user_id: `user-${id}`,
    discord_id: `discord-${id}`,
    type: "discord_webhook",
    payload_json: JSON.stringify({ content: id }),
    attempt_count: 0,
  };
}

test("開始前abortはD1 read/writeを開始しない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("cron deadline", "AbortError");
  controller.abort(reason);
  let prepareCalls = 0;
  const env = {
    DB: {
      prepare() {
        prepareCalls += 1;
        throw new Error("D1 must not be called after abort");
      },
    },
  };

  await assert.rejects(
    processNotificationQueue(env, { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(prepareCalls, 0);
});

test("D1 selection中のabortはitem claimとDiscord送信を開始しない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("selection aborted", "AbortError");
  let claimWrites = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  };
  const env = {
    DISCORD_WEBHOOK_URL: "https://example.test/selection-abort",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            if (sql.includes("SET status = 'processing'")) claimWrites += 1;
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes("FROM notification_outbox n")) {
              controller.abort(reason);
              return { results: [pendingWebhookRow("selection")] };
            }
            return { results: [] };
          },
        };
      },
    },
  };

  try {
    await assert.rejects(
      processNotificationQueue(env, { signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(claimWrites, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("claim D1 write中のabortはDiscord送信とfailure更新へ進まない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("claim aborted", "AbortError");
  let failureWrites = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  };
  const env = {
    DISCORD_WEBHOOK_URL: "https://example.test/claim-abort",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            if (sql.includes("SET status = 'processing'")) {
              controller.abort(reason);
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET attempt_count")) failureWrites += 1;
            return { meta: { changes: 0 } };
          },
          async all() {
            return sql.includes("FROM notification_outbox n")
              ? { results: [pendingWebhookRow("claim")] }
              : { results: [] };
          },
        };
      },
    },
  };

  try {
    await assert.rejects(
      processNotificationQueue(env, { signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(failureWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Discord fetch中のAbortErrorを再送出しretry/dead-letterへ変換しない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("discord fetch aborted", "AbortError");
  let failureWrites = 0;
  let sentWrites = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    controller.abort(reason);
    assert.equal(init.signal.aborted, true);
    throw new DOMException("fetch cancelled", "AbortError");
  };
  const env = {
    DISCORD_WEBHOOK_URL: "https://example.test/fetch-abort",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            if (sql.includes("SET attempt_count")) failureWrites += 1;
            if (sql.includes("SET status = 'sent'")) sentWrites += 1;
            return {
              meta: {
                changes: sql.includes("SET status = 'processing'") ? 1 : 0,
              },
            };
          },
          async all() {
            return sql.includes("FROM notification_outbox n")
              ? { results: [pendingWebhookRow("fetch")] }
              : { results: [] };
          },
        };
      },
    },
  };

  try {
    await assert.rejects(
      processNotificationQueue(env, { signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(fetchCalls, 1);
    assert.equal(failureWrites, 0);
    assert.equal(sentWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("item完了D1境界でabortしたら次itemをclaimしない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("item boundary aborted", "AbortError");
  let claimWrites = 0;
  let sentWrites = 0;
  let failureWrites = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  };
  const env = {
    DISCORD_WEBHOOK_URL: "https://example.test/item-boundary-abort",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            if (sql.includes("SET status = 'processing'")) {
              claimWrites += 1;
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'sent'")) {
              sentWrites += 1;
              controller.abort(reason);
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET attempt_count")) failureWrites += 1;
            return { meta: { changes: 0 } };
          },
          async all() {
            return sql.includes("FROM notification_outbox n")
              ? {
                  results: [
                    pendingWebhookRow("first"),
                    pendingWebhookRow("second"),
                  ],
                }
              : { results: [] };
          },
        };
      },
    },
  };

  try {
    await assert.rejects(
      processNotificationQueue(env, { signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(claimWrites, 1);
    assert.equal(sentWrites, 1);
    assert.equal(fetchCalls, 1);
    assert.equal(failureWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
