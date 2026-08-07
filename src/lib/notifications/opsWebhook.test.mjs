import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const opsWebhookSource = await readFile(
    new URL("./opsWebhook.ts", import.meta.url),
    "utf8",
  );
  const { sanitizeDiscordThreadName } = await import("./forum.ts");
  const { validateNotificationPayload } = await import("./format.ts");

  test("opsWebhook.ts は target/threadName を payload へマージする", () => {
    assert.match(opsWebhookSource, /webhook_target: input\.target/);
    assert.match(opsWebhookSource, /sanitizeDiscordThreadName/);
    assert.match(opsWebhookSource, /type: "discord_webhook"/);
  });

  test("ops webhook payload マージ結果は validateNotificationPayload を通る", () => {
    const payload = {
      content: "hello",
      webhook_target: "system",
      thread_name: sanitizeDiscordThreadName(
        "[通知エラー] video_approved",
        "[通知] system",
      ),
    };
    const check = validateNotificationPayload("discord_webhook", payload);
    assert.equal(check.ok, true);
    assert.equal(payload.thread_name, "[通知エラー] video_approved");
  });
}
