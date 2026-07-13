import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyYoutubeApiError,
  orderYoutubeApiKeys,
  resolveYoutubeApiKeys,
  runWithYoutubeApiKeyFailover,
  shouldFailoverYoutubeApiKey,
  YoutubeApiRequestError,
  YOUTUBE_API_KEY_DISABLE_SEC,
  YOUTUBE_API_KEY_STATUS_KV,
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
    YOUTUBE_API_KEY: "primary-secret",
    YOUTUBE_API_KEY_SECONDARY: "secondary-secret",
  });
  await assert.rejects(
    runWithYoutubeApiKeyFailover(
      { KV: kv },
      keys,
      10_000,
      async (candidate) => {
        calls.push(candidate.key);
        throw new YoutubeApiRequestError("quota", "quotaexceeded", 403);
      },
    ),
    /quota:youtube_api_quotaexceeded/,
  );
  assert.deepEqual(calls, ["primary-secret"]);
});

test("主キーのcredential障害時だけ副キーへ切り替える", async () => {
  assert.equal(classifyYoutubeApiError(400, "keyInvalid"), "credential");
  assert.equal(shouldFailoverYoutubeApiKey(400, "keyInvalid"), true);

  const kv = createKv();
  const calls = [];
  const keys = resolveYoutubeApiKeys({
    YOUTUBE_API_KEY: "primary-secret",
    YOUTUBE_API_KEY_SECONDARY: "secondary-secret",
  });
  const result = await runWithYoutubeApiKeyFailover(
    { KV: kv },
    keys,
    10_000,
    async (candidate) => {
      calls.push(candidate.key);
      if (candidate.label === "primary") {
        throw new YoutubeApiRequestError("credential", "keyinvalid", 400);
      }
      return { items: [{ id: "video-1" }] };
    },
  );

  assert.deepEqual(calls, ["primary-secret", "secondary-secret"]);
  assert.deepEqual(result, { items: [{ id: "video-1" }] });
  const serialized = kv.values.get(YOUTUBE_API_KEY_STATUS_KV);
  const status = JSON.parse(serialized);
  assert.equal(status.active_key, "secondary");
  assert.equal(status.disabled_until.primary, 10_000 + YOUTUBE_API_KEY_DISABLE_SEC);
  assert.equal(status.last_failover_from, "primary");
  assert.equal(status.last_failure_kind, "credential");
  assert.doesNotMatch(serialized, /primary-secret|secondary-secret/);
});
