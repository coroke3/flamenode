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

test("score変更時はtopとlist_popularとrecommend_coreを重複排除付きで再生成予約する", () => {
  assert.match(source, /from "\.\/scoreRankingRebuildThrottle\.ts"/);
  assert.match(source, /enqueueScoreDependentRebuilds\(env, signal\)/);
  assert.match(source, /rankingRebuild\.processed/);
  assert.doesNotMatch(source, /INSERT OR IGNORE INTO static_rebuild_queue/);
});

test("score起因ランキングenqueueは専用throttleモジュールへ委譲する", () => {
  assert.match(source, /scoreRankingRebuildThrottle/);
  assert.match(source, /ranking-rebuild-enqueue/);
  assert.doesNotMatch(source, /enqueueStaticRebuild/);
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
  assert.match(source, /syncEventPlaylists\(budgetEnv, signal\)/);
  assert.match(source, /syncBatch\(budgetEnv, undefined, signal,/);
  assert.match(source, /mode:\s*"scheduled_only"/);
});

test("GA4 trending sync runs before youtube metadata in 07 slot", () => {
  assert.match(source, /ga4-trending-sync/);
  assert.match(source, /syncGa4Trending\(budgetEnv, signal\)/);
  const cronBlock = source.slice(source.indexOf("export async function runSyncJobs"));
  const ga4Index = cronBlock.indexOf("ga4-trending-sync");
  const youtubeIndex = cronBlock.indexOf("youtube-sync-metadata");
  assert.ok(ga4Index > 0 && youtubeIndex > 0);
  assert.ok(ga4Index < youtubeIndex);
  assert.doesNotMatch(
    source,
    /isPlaylistSyncSlot[\s\S]{0,500}ga4-trending-sync/,
  );
});

test("Cron全体とQueue consumerは同じD1 hard-limit guardを使う", () => {
  assert.match(source, /import \{ withD1Budget \} from "\.\.\/shared\/d1Budget\.ts"/);
  const cronBlock = source.slice(source.indexOf("export async function runSyncJobs"));
  assert.match(cronBlock, /const budgetEnv = withD1Budget\(env\)/);
  assert.match(cronBlock, /withCronLease\(\s*budgetEnv,/);
  assert.match(cronBlock, /syncEventPlaylists\(budgetEnv, signal\)/);
  assert.match(cronBlock, /syncGa4Trending\(budgetEnv, signal\)/);
  assert.match(cronBlock, /syncBatch\(budgetEnv, undefined, signal,/);
  assert.match(cronBlock, /runYoutubeSyncPostCommit\(budgetEnv, youtube,/);
  const queueBlock = source.slice(source.indexOf("export default"));
  assert.match(
    queueBlock,
    /handleYoutubeSyncWakeQueue\(batch, withD1Budget\(env\)\)/,
  );
});
