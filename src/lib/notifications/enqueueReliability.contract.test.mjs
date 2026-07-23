import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [chapter, createFreeVideo, submitSlotVideo, adminVideo, manageVideo, rules] =
  await Promise.all([
    readFile(new URL("../actions/chapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/video/createFreeVideo.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/video/submitSlotVideo.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/manage-video.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/rules.ts", import.meta.url), "utf8"),
  ]);

test("onConflictDoNothing notification inserts use null expected changes", () => {
  for (const source of [chapter, createFreeVideo, submitSlotVideo]) {
    assert.match(
      source,
      /notification\.statement[\s\S]*?expected(?:Mutation)?Changes\.push\(null\)/,
    );
    assert.doesNotMatch(
      source,
      /notification\.statement[\s\S]*?expected(?:Mutation)?Changes\.push\(1\)/,
    );
  }
});

test("video status mutations wake notification queue when outbox rows are added", () => {
  assert.match(
    adminVideo,
    /notificationWakeSource:\s*\n\s*notification\.statements\.length > 0 \? "admin" : undefined/,
  );
  assert.match(
    manageVideo,
    /notificationWakeSource:\s*\n\s*notification\.statements\.length > 0 \? "manage" : undefined/,
  );
});

test("terms reaccept broadcast uses absolute rules URL in Discord payload", () => {
  assert.match(rules, /appUrl\("\/rules"\)/);
  assert.match(rules, /terms_url: rulesUrl/);
  assert.doesNotMatch(rules, /terms_url: "\/rules"/);
});
