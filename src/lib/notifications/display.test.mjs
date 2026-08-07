import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const displaySource = await readFile(new URL("./display.ts", import.meta.url), "utf8");

test("getNotificationFailureGuidance: forum_webhook_unconfigured は Forum 用 secret 名を先に案内する", () => {
  const forumIdx = displaySource.indexOf('err.includes("forum_webhook_unconfigured")');
  const genericIdx = displaySource.indexOf('err.includes("webhook_unconfigured")');
  assert.ok(forumIdx >= 0);
  assert.ok(genericIdx > forumIdx, "forum_webhook_unconfigured must be checked before webhook_unconfigured");
  const forumBlock = displaySource.slice(forumIdx, genericIdx);
  assert.match(forumBlock, /DISCORD_WEBHOOK_URL_FORUM_ACCOUNT/);
  assert.match(forumBlock, /DISCORD_WEBHOOK_URL_FORUM_EVENT/);
  assert.match(forumBlock, /DISCORD_WEBHOOK_URL_FORUM_SYSTEM/);
  assert.match(forumBlock, /forum_webhook_unconfigured:\(account\|event\|system\)/);
  assert.match(forumBlock, /webhook_target 無しの旧通知行のみ/);
  assert.doesNotMatch(forumBlock, /移行中は legacy/);
});

test("getNotificationFailureGuidance: webhook_unconfigured は Forum trio と legacy を案内する", () => {
  const genericIdx = displaySource.indexOf('err.includes("webhook_unconfigured")');
  const botIdx = displaySource.indexOf('err.includes("bot_token_unconfigured")');
  assert.ok(genericIdx >= 0);
  assert.ok(botIdx > genericIdx);
  const webhookBlock = displaySource.slice(genericIdx, botIdx);
  assert.match(webhookBlock, /DISCORD_WEBHOOK_URL_FORUM_ACCOUNT/);
  assert.match(webhookBlock, /DISCORD_WEBHOOK_URL_FORUM_EVENT/);
  assert.match(webhookBlock, /DISCORD_WEBHOOK_URL_FORUM_SYSTEM/);
  assert.match(webhookBlock, /DISCORD_WEBHOOK_URL/);
});

test("getNotificationFailureGuidance: bot_token_unconfigured 案内を維持する", () => {
  assert.match(displaySource, /err\.includes\("bot_token_unconfigured"\)/);
  assert.match(displaySource, /DISCORD_BOT_TOKEN/);
});
