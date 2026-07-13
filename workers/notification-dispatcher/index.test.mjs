import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "./index.ts";

function okJson(value = {}, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

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
