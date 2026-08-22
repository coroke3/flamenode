import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./createFreeVideo.ts", import.meta.url), "utf8");

test("createFreeVideo は writeGuard 通過後・解析/R2前に active_x_snapshot を検証する", () => {
  const fnStart = source.indexOf("export async function createFreeVideo");
  const fnBody = source.slice(fnStart);
  const activeXCheck = fnBody.indexOf("guard.approvedXIds.includes(activeX)");
  const snapshotCheck = fnBody.indexOf("validateActiveXSnapshot");
  const parseForm = fnBody.indexOf("parseVideoForm");
  const iconResolve = fnBody.indexOf("resolveVideoCreatorIcon");

  assert.ok(activeXCheck >= 0);
  assert.ok(snapshotCheck > activeXCheck);
  assert.ok(parseForm > snapshotCheck);
  assert.ok(iconResolve > snapshotCheck);
  assert.match(fnBody, /active_x_snapshot/);
});

test("createFreeVideo は video_create で top section visibility targets を enqueue する", () => {
  assert.match(source, /topVideoVisibilityTargets\("video_create"\)/);
  const queueBlock = source.match(/const queueTargets = \[[\s\S]*?\];/)?.[0];
  assert.ok(queueBlock);
  assert.match(queueBlock, /\.\.\.topVideoVisibilityTargets\("video_create"\)/);
});

test("イベント付きfree投稿はevent baseとslotsを同じqueue batchへ入れる", () => {
  const queueBlock = source.match(/const queueTargets = \[[\s\S]*?\];/)?.[0];
  assert.ok(queueBlock);
  const eventBranch = queueBlock.match(/\.\.\.\(eventId[\s\S]*?\]/)?.[0] ?? "";
  assert.match(eventBranch, /targetType: "event_base"/);
  assert.match(eventBranch, /targetType: "event_slots"/);
});

test("createFreeVideo は buildOpsChannelWebhookStatement を event target で呼ぶ", () => {
  assert.match(source, /buildOpsChannelWebhookStatement/);
  assert.match(source, /target:\s*"event"/);
});

test("createFreeVideo rejects a non-empty invalid scheduled_time instead of using now", () => {
  assert.match(source, /parseJstDatetimeLocalStrict/);
  assert.match(source, /if \(!scheduledParsed\.ok\)/);
  assert.match(source, /scheduledParsed\.value \?\? now/);
});
