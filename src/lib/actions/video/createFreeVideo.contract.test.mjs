import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./createFreeVideo.ts", import.meta.url), "utf8");
const fanout = await readFile(new URL("../../../../packages/server-core/src/video/freeVideoRebuildTargets.ts", import.meta.url), "utf8");

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

test("createFreeVideo は共有fanoutで top section visibility targets を同じD1 batchへenqueueする", () => {
  assert.match(source, /import \{ buildFreeVideoRebuildTargets \} from "@flamenode\/server-core\/video\/freeVideoRebuildTargets"/);
  assert.match(source, /const queueTargets = buildFreeVideoRebuildTargets\(\{[\s\S]*?activeXId: activeX,[\s\S]*?eventId,[\s\S]*?\}\)/);
  assert.match(source, /buildStaticRebuildQueueBatch\(db, queueTargets\)/);
  assert.match(fanout, /\.\.\.topVideoVisibilityTargets\("video_create"\)/);
});

test("イベント付きfree投稿は共有fanout経由でevent base・slots・releaseを同じqueue batchへ入れる", () => {
  assert.match(source, /const queueTargets = buildFreeVideoRebuildTargets\(/);
  assert.match(source, /buildStaticRebuildQueueBatch\(db, queueTargets\)/);
  const eventBranch = fanout.match(/\.\.\.\(eventId[\s\S]*?: \[\]/)?.[0] ?? "";
  assert.match(eventBranch, /targetType: "event_base"/);
  assert.match(eventBranch, /targetType: "event_slots"/);
  assert.match(eventBranch, /targetType: "event_release"/);
});

test("createFreeVideo は作品登録の運営チャンネル通知を event target で積む", async () => {
  assert.match(source, /buildVideoRegisteredChannelStatement\(db, \{/);
  const channelSource = await readFile(
    new URL("../../notifications/videoRegisteredChannel.ts", import.meta.url),
    "utf8",
  );
  assert.match(channelSource, /buildOpsChannelWebhookStatement\(db, \{/);
  assert.match(channelSource, /target:\s*"event"/);
});

test("createFreeVideo rejects a non-empty invalid scheduled_time instead of using now", () => {
  assert.match(source, /parseJstDatetimeLocalStrict/);
  assert.match(source, /if \(!scheduledParsed\.ok\)/);
  assert.match(source, /scheduledParsed\.value \?\? now/);
});

test("createFreeVideo は eventIds 決定後・保存前にイベント必須項目を検証する", () => {
  assert.match(source, /loadUnionRequiredVideoFields/);
  assert.match(source, /firstMissingRequiredVideoField/);
  assert.match(source, /missingRequiredVideoFieldMessage/);

  const fnStart = source.indexOf("export async function createFreeVideo");
  const fnBody = source.slice(fnStart);
  const eventIdsIndex = fnBody.indexOf("const eventIds = eventId ? [eventId] : []");
  const missingRequiredIndex = fnBody.indexOf("firstMissingRequiredVideoField");
  const generateIdIndex = fnBody.indexOf('generateId("v")');
  const insertIndex = fnBody.indexOf("db.insert(videos)");

  assert.ok(eventIdsIndex >= 0);
  assert.ok(missingRequiredIndex > eventIdsIndex, "必須項目検証は eventIds 決定の後");
  assert.ok(generateIdIndex > missingRequiredIndex, "generateId は必須項目検証の後");
  assert.ok(insertIndex > missingRequiredIndex, "insert は必須項目検証の後");
  assert.match(
    fnBody.slice(missingRequiredIndex, missingRequiredIndex + 300),
    /loadUnionRequiredVideoFields\(db, eventIds\)/,
  );
});
