import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isPlaylistSyncSlot } from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const sharedSource = await readFile(
  new URL("../shared/createCronWorker.ts", import.meta.url),
  "utf8",
);

test("sync-jobs health は共通Cron Workerからserviceとcommitを返す", () => {
  assert.match(source, /createCronWorker/);
  assert.match(source, /service:\s*"flamenode-sync-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(sharedSource, /async fetch\(/);
  assert.match(sharedSource, /pathname\s*===\s*[\r\n\s]*"\/health"/);
  assert.match(sharedSource, /commit:/);
  assert.match(sharedSource, /env\.BUILD_COMMIT_SHA/);
});

test("score変更時はtopとlist_popularとrecommendを重複排除付きで再生成予約する", () => {
  assert.match(source, /INSERT OR IGNORE INTO static_rebuild_queue/);
  assert.match(source, /\["top",\s*"list_popular",\s*"recommend"\]/);
  assert.match(source, /score\.processed\s*>\s*0/);
});

test("UTC分が52の時だけを再生リスト同期の専用枠にする", () => {
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:07:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:22:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:37:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:50:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:51:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:52:00Z")), true);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:53:00Z")), false);
  assert.equal(isPlaylistSyncSlot(new Date("2026-07-13T00:59:00Z")), false);
  assert.match(source, /youtube-playlist-sync/);
  assert.match(source, /isPlaylistSyncSlot\(new Date\(execution\.scheduledTime\)\)/);
  assert.doesNotMatch(source, /if \(isPlaylistSyncSlot\(\)\)/);
});

test("Cron deadline signalをmetadata同期とplaylist同期へ渡す", () => {
  assert.match(source, /syncEventPlaylists\(env, signal\)/);
  assert.match(source, /syncBatch\(env, undefined, signal,/);
  assert.match(source, /mode:\s*"scheduled_only"/);
});
