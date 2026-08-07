import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isOpsWebhookTarget,
  OPS_WEBHOOK_TARGETS,
  resolveForumWebhookUrl,
  sanitizeDiscordThreadName,
} from "./forum.ts";

test("OPS_WEBHOOK_TARGETS は account/event/system", () => {
  assert.deepEqual(OPS_WEBHOOK_TARGETS, ["account", "event", "system"]);
});

test("isOpsWebhookTarget は有効値だけを受理する", () => {
  assert.equal(isOpsWebhookTarget("account"), true);
  assert.equal(isOpsWebhookTarget("event"), true);
  assert.equal(isOpsWebhookTarget("system"), true);
  assert.equal(isOpsWebhookTarget("legacy"), false);
  assert.equal(isOpsWebhookTarget(null), false);
});

test("sanitizeDiscordThreadName は改行・制御文字を除去し100文字に制限する", () => {
  assert.equal(
    sanitizeDiscordThreadName("  hello\nworld\t", "[fallback]"),
    "hello world",
  );
  assert.equal(sanitizeDiscordThreadName("", "[通知] system"), "[通知] system");
  const long = "a".repeat(120);
  assert.equal(sanitizeDiscordThreadName(long, "fb").length, 100);
});

test("sanitizeDiscordThreadName は @everyone/@here と snowflake メンションを無害化する", () => {
  assert.equal(
    sanitizeDiscordThreadName("@everyone alert", "fb"),
    "@\u200beveryone alert",
  );
  assert.equal(
    sanitizeDiscordThreadName("@HERE ping", "fb"),
    "@\u200bHERE ping",
  );
  assert.equal(
    sanitizeDiscordThreadName("role <@&123456789> user <@987654321>", "fb"),
    "role user",
  );
  assert.equal(
    sanitizeDiscordThreadName("handle @myHandle stays", "fb"),
    "handle @myHandle stays",
  );
});

test("resolveForumWebhookUrl: target 指定時は対応 FORUM URL 必須（クロスフォールバックなし）", () => {
  const env = {
    DISCORD_WEBHOOK_URL: "https://example.test/legacy",
    DISCORD_WEBHOOK_URL_FORUM_ACCOUNT: "https://example.test/account",
    DISCORD_WEBHOOK_URL_FORUM_EVENT: "https://example.test/event",
    DISCORD_WEBHOOK_URL_FORUM_SYSTEM: "https://example.test/system",
  };
  assert.deepEqual(resolveForumWebhookUrl(env, "account"), {
    url: "https://example.test/account",
    kind: "forum",
  });
  assert.deepEqual(resolveForumWebhookUrl(env, "event"), {
    url: "https://example.test/event",
    kind: "forum",
  });
  assert.deepEqual(resolveForumWebhookUrl(env, "system"), {
    url: "https://example.test/system",
    kind: "forum",
  });
  const missing = resolveForumWebhookUrl(
  { DISCORD_WEBHOOK_URL: "https://example.test/legacy" },
  "account",
  );
  assert.equal("error" in missing && missing.error, "forum_webhook_unconfigured:account");
});

test("resolveForumWebhookUrl: target 未指定時は legacy DISCORD_WEBHOOK_URL", () => {
  assert.deepEqual(
    resolveForumWebhookUrl({ DISCORD_WEBHOOK_URL: "https://example.test/legacy" }, null),
    { url: "https://example.test/legacy", kind: "legacy" },
  );
  const missing = resolveForumWebhookUrl({}, null);
  assert.equal("error" in missing && missing.error, "discord_channel_webhook_unconfigured");
});
