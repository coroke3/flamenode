/**
 * validateNotificationPayload の単体テスト。
 * 実行: npm run test:notif (または node --test src/lib/notifications/format.test.mjs)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    appUrl,
    notificationSiteOrigin,
    validateNotificationPayload,
  } = await import("./format.ts");

  test("通知URLはNEXT_PUBLIC_SITE_URLだけをorigin正本にする", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://flamenode.example/",
      NEXT_PUBLIC_APP_URL: "https://ignored.example",
      APP_ORIGIN: "https://ignored.example",
    };
    assert.equal(notificationSiteOrigin(env), "https://flamenode.example");
    assert.equal(
      appUrl("/dashboard/edit/video-1", env),
      "https://flamenode.example/dashboard/edit/video-1",
    );
  });

  test("通知origin欠落・不正scheme・本番localhostをfail-closedで拒否する", () => {
    assert.throws(() => notificationSiteOrigin({ NODE_ENV: "production" }), /MISSING/);
    assert.throws(
      () =>
        notificationSiteOrigin({
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "javascript:alert(1)",
        }),
      /INVALID_ORIGIN/,
    );
    assert.throws(
      () =>
        notificationSiteOrigin({
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        }),
      /LOCALHOST_FORBIDDEN/,
    );
    assert.equal(
      notificationSiteOrigin({
        NODE_ENV: "development",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      }),
      "http://localhost:3000",
    );
  });

  test("通知pathから外部originへ切り替えられない", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
    };
    assert.throws(() => appUrl("https://evil.example/path", env), /MUST_BE_RELATIVE/);
    assert.throws(() => appUrl("//evil.example/path", env), /MUST_BE_RELATIVE/);
  });

  test("正常系: 最小限の type + payload で OK", () => {
    const r = validateNotificationPayload("video_approved", { content: "ok" });
    assert.equal(r.ok, true);
  });

  test("type が空文字なら NG", () => {
    const r = validateNotificationPayload("", { content: "ok" });
    assert.equal(r.ok, false);
  });

  test("type が文字列でないなら NG", () => {
    const r = validateNotificationPayload(null, { content: "ok" });
    assert.equal(r.ok, false);
    const r2 = validateNotificationPayload(123, { content: "ok" });
    assert.equal(r2.ok, false);
  });

  test("type に不正文字 (ハイフン) があれば NG", () => {
    const r = validateNotificationPayload("video-approved", { content: "ok" });
    assert.equal(r.ok, false);
  });

  test("type 長すぎ (65 文字) は NG", () => {
    const longType = "x".repeat(65);
    const r = validateNotificationPayload(longType, { content: "ok" });
    assert.equal(r.ok, false);
  });

  test("payload が null / 配列なら NG", () => {
    assert.equal(validateNotificationPayload("ok", null).ok, false);
    assert.equal(validateNotificationPayload("ok", []).ok, false);
  });

  test("payload.content が文字列以外なら NG", () => {
    const r = validateNotificationPayload("ok", { content: 123 });
    assert.equal(r.ok, false);
  });

  test("payload.content が 2001 文字なら NG", () => {
    const r = validateNotificationPayload("ok", { content: "a".repeat(2001) });
    assert.equal(r.ok, false);
  });

  test("payload.content が 2000 文字なら OK", () => {
    const r = validateNotificationPayload("ok", { content: "a".repeat(2000) });
    assert.equal(r.ok, true);
  });

  test("payload が 8KB を超えると NG", () => {
    const big = "a".repeat(8 * 1024 + 100);
    const r = validateNotificationPayload("ok", { data: big });
    assert.equal(r.ok, false);
  });

  test("payload に content がなくても他のキーがあれば OK", () => {
    const r = validateNotificationPayload("custom_event", { video_id: "vid_1" });
    assert.equal(r.ok, true);
  });

  test("webhook_target 不正は NG", () => {
    const r = validateNotificationPayload("discord_webhook", {
      content: "ok",
      webhook_target: "invalid",
    });
    assert.equal(r.ok, false);
  });

  test("webhook_target 有効値は OK", () => {
    const r = validateNotificationPayload("discord_webhook", {
      content: "ok",
      webhook_target: "system",
    });
    assert.equal(r.ok, true);
  });

  test("thread_name が 101 文字は NG", () => {
    const r = validateNotificationPayload("discord_webhook", {
      content: "ok",
      thread_name: "a".repeat(101),
    });
    assert.equal(r.ok, false);
  });

  test("thread_name が 100 文字は OK", () => {
    const r = validateNotificationPayload("discord_webhook", {
      content: "ok",
      thread_name: "a".repeat(100),
    });
    assert.equal(r.ok, true);
  });
}
