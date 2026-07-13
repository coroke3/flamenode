import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyYoutubeApiError,
  fetchYoutubeJsonWithFailover,
  isRetryableYoutubeStatus,
  orderYoutubeApiKeys,
  parseRetryAfterMs,
  resolveYoutubeApiKeys,
  shouldFailoverYoutubeApiKey,
  YOUTUBE_API_KEY_DISABLE_SEC,
  YOUTUBE_API_KEY_STATUS_KV,
  YOUTUBE_API_MAX_ATTEMPTS,
  YOUTUBE_API_MAX_KEYS,
} from "./apiKeyFailover.ts";

function createKv() {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function errorResponse(status, reason) {
  return new Response(
    JSON.stringify({ error: { errors: [{ reason }] } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

test("429と5xxは同一キーの再試行対象", () => {
  assert.equal(isRetryableYoutubeStatus(429), true);
  assert.equal(isRetryableYoutubeStatus(503), true);
  assert.equal(isRetryableYoutubeStatus(400), false);
  assert.equal(YOUTUBE_API_MAX_ATTEMPTS, 2);
});

test("Retry-Afterを上限付きで変換する", () => {
  assert.equal(parseRetryAfterMs("3"), 3_000);
  assert.equal(parseRetryAfterMs("120"), 15_000);
});

test("主キーと副キーを順序維持して重複排除する", () => {
  assert.equal(YOUTUBE_API_MAX_KEYS, 2);
  assert.deepEqual(
    resolveYoutubeApiKeys({
      YOUTUBE_API_KEY: " primary ",
      YOUTUBE_API_KEY_SECONDARY: " secondary ",
    }),
    [
      { label: "primary", key: "primary" },
      { label: "secondary", key: "secondary" },
    ],
  );
  assert.deepEqual(
    resolveYoutubeApiKeys({
      YOUTUBE_API_KEY: "same",
      YOUTUBE_API_KEY_SECONDARY: "same",
    }),
    [{ label: "primary", key: "same" }],
  );
});

test("credential障害中のキーを6時間回避する", () => {
  const keys = resolveYoutubeApiKeys({
    YOUTUBE_API_KEY: "primary",
    YOUTUBE_API_KEY_SECONDARY: "secondary",
  });
  assert.equal(YOUTUBE_API_KEY_DISABLE_SEC, 6 * 60 * 60);
  assert.deepEqual(
    orderYoutubeApiKeys(keys, { primary: 20_000 }, 10_000).map((item) => item.label),
    ["secondary"],
  );
  assert.deepEqual(
    orderYoutubeApiKeys(keys, { primary: 9_999 }, 10_000).map((item) => item.label),
    ["primary", "secondary"],
  );
});

test("quota超過は副キーへ切り替えない", async () => {
  assert.equal(classifyYoutubeApiError(403, "quotaExceeded"), "quota");
  assert.equal(shouldFailoverYoutubeApiKey(403, "quotaExceeded"), false);

  const kv = createKv();
  const calls = [];
  const keys = resolveYoutubeApiKeys({
    YOUTUBE_API_KEY: "primary",
    YOUTUBE_API_KEY_SECONDARY: "secondary",
  });
  await assert.rejects(
    fetchYoutubeJsonWithFailover(
      { KV: kv },
      new URL("https://example.invalid/videos"),
      keys,
      async (url) => {
        calls.push(new URL(url).searchParams.get("key"));
        return errorResponse(403, "quotaExceeded");
      },
      10_000,
    ),
    /quota:youtube_api_quotaexceeded/,
  );
  assert.deepEqual(calls, ["primary"]);
});

test("主キーのcredential障害時だけ副キーへ切り替える", async () => {
  assert.equal(classifyYoutubeApiError(400, "keyInvalid"), "credential");
  assert.equal(shouldFailoverYoutubeApiKey(400, "keyInvalid"), true);

  const kv = createKv();
  const calls = [];
  const keys = resolveYoutubeApiKeys({
    YOUTUBE_API_KEY: "primary",
    YOUTUBE_API_KEY_SECONDARY: "secondary",
  });
  const result = await fetchYoutubeJsonWithFailover(
    { KV: kv },
    new URL("https://example.invalid/videos"),
    keys,
    async (url) => {
      const key = new URL(url).searchParams.get("key");
      calls.push(key);
      return key === "primary"
        ? errorResponse(400, "keyInvalid")
        : Response.json({ items: [{ id: "video-1" }] });
    },
    10_000,
  );

  assert.deepEqual(calls, ["primary", "secondary"]);
  assert.deepEqual(result, { items: [{ id: "video-1" }] });
  const status = JSON.parse(kv.values.get(YOUTUBE_API_KEY_STATUS_KV));
  assert.equal(status.active_key, "secondary");
  assert.equal(status.disabled_until.primary, 10_000 + YOUTUBE_API_KEY_DISABLE_SEC);
  assert.equal(status.last_failover_from, "primary");
  assert.equal(status.last_failure_kind, "credential");
  assert.doesNotMatch(JSON.stringify(status), /primary|secondary-key/);
});
