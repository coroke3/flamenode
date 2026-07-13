import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./dispatch.ts", import.meta.url), "utf8");

test("Discord route cooldownはglobal cooldownも横断確認する", () => {
  assert.match(source, /DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global"/);
  assert.match(
    source,
    /activeCooldownUntil\(DISCORD_GLOBAL_COOLDOWN_KEY, now\)/,
  );
  assert.match(source, /x-ratelimit-global/);
  assert.match(source, /x-ratelimit-scope/);
  assert.match(source, /body\.global === true/);
});

test("Discord 429はinline retryせず次回実行へ繰り越す", () => {
  const failureSection = source.slice(
    source.indexOf("async function discordFailure"),
    source.indexOf("async function recoverExpiredLeases"),
  );
  assert.match(failureSection, /retryAfterSeconds/);
  assert.doesNotMatch(failureSection, /await delay/);
  assert.doesNotMatch(failureSection, /for \(let attempt/);
});
