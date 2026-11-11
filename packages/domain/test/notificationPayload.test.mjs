import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNotificationPayload } from "../src/notifications/payload.ts";

test("SA-084 validator rejects malformed type and payload shapes", () => {
  for (const type of [null, 3, "", "with-hyphen", "x".repeat(65)]) {
    assert.equal(validateNotificationPayload(type, { content: "ok" }).ok, false);
  }
  for (const payload of [null, [], 3, { content: 42 }, { content: "x".repeat(2001) }]) {
    assert.equal(validateNotificationPayload("video_edit_permission_granted", payload).ok, false);
  }
  assert.equal(validateNotificationPayload("ok", { content: "x".repeat(2000) }).ok, true);
});

test("SA-084 validator enforces UTF-8 byte cap, not JS code unit length", () => {
  // JSON.stringify({body:...}) adds 11 UTF-8 bytes to the body string.
  assert.equal(validateNotificationPayload("ok", { body: "あ".repeat(2727) }).ok, true);
  assert.equal(validateNotificationPayload("ok", { body: "あ".repeat(2728) }).ok, false);
  assert.equal(validateNotificationPayload("ok", { body: "a".repeat(8200) }).ok, false);
});

test("SA-084 webhook target and forum thread shape have CURRENT boundaries", () => {
  for (const target of ["account", "event", "system"]) {
    assert.deepEqual(validateNotificationPayload("discord_webhook", {
      content: "ok", webhook_target: target, thread_name: "a".repeat(100),
    }), { ok: true });
  }
  for (const target of ["admin", "", null, 123]) {
    assert.equal(validateNotificationPayload("discord_webhook", { webhook_target: target }).ok, false);
  }
  assert.equal(validateNotificationPayload("discord_webhook", { thread_name: "a".repeat(101) }).ok, false);
  assert.equal(validateNotificationPayload("discord_webhook", { thread_name: 1 }).ok, false);
  assert.equal(validateNotificationPayload("ok", { other: "ok" }).ok, true);
});

test("SA-084 validator fails closed for nonserializable notifications", () => {
  const cycle = {}; cycle.self = cycle;
  assert.equal(validateNotificationPayload("video_edit_permission_granted", cycle).ok, false);
  assert.equal(validateNotificationPayload("video_edit_permission_granted", { data: 1n }).ok, false);
});
