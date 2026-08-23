import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isPlaylistSyncSlot } from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const sharedSource = await readFile(
  new URL("../shared/createCronWorker.ts", import.meta.url),
  "utf8",
);
const wakeBudgetSource = await readFile(
  new URL("../../src/lib/queues/wakeBudget.ts", import.meta.url),
  "utf8",
);
const playlistActionSource = await readFile(
  new URL("../../src/lib/actions/event-youtube-playlist.ts", import.meta.url),
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

test("UTC分が52の時だけを再生リスト同期の専用Cron枠にする", () => {
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

test("再生リスト手動予約はD1 commit後にQueue wakeし52分Cronをfallbackに残す", () => {
  assert.match(wakeBudgetSource, /"youtube_playlist_sync"/);
  assert.match(
    wakeBudgetSource,
    /case "youtube_sync_pending":[\s\S]*case "youtube_playlist_sync":[\s\S]*youtubeSyncWake/,
  );
  assert.match(playlistActionSource, /sendYoutubePlaylistSyncWakeBestEffort\("manage"\)/);
  assert.match(playlistActionSource, /next_sync_at:\s*now/);
  assert.match(source, /wake\?\.kind === "youtube_playlist_sync"/);
  assert.match(source, /syncEventPlaylists\(env\)/);
  assert.match(source, /ackAll\(playlistMessages\)/);
  assert.match(source, /retryAll\(playlistMessages\)/);
  assert.match(source, /syncEventPlaylists\(env, signal\)/);
});

test("playlist backlogはindexed due判定後に1件だけcontinuation wakeする", () => {
  assert.match(source, /async function maybeContinueYoutubePlaylistSync/);
  assert.match(source, /flags\.continuationEnabled/);
  assert.match(
    source,
    /SELECT 1 AS due[\s\S]*FROM event_youtube_playlist_sync[\s\S]*COALESCE\(next_sync_at, 0\) <= \?1[\s\S]*LIMIT 1/,
  );
  assert.match(
    source,
    /kind:\s*"youtube_playlist_sync"[\s\S]*source:\s*"continuation"/,
  );
  assert.match(source, /continued \|\|= playlistContinued/);
  assert.match(source, /playlistJob\.quota_stopped/);
  assert.match(source, /playlistCounters\.quota_stopped/);
  assert.match(source, /deferred_to_recovery/);
  assert.ok(
    source.match(/maybeContinueYoutubePlaylistSync\(/g)?.length >= 3,
    "helper definition + Queue + Cron calls are required",
  );
});

test("metadataとplaylistのQueueメッセージは別々にack/retryする", () => {
  assert.match(source, /const metadataMessages: Message<unknown>\[\] = \[\]/);
  assert.match(source, /const playlistMessages: Message<unknown>\[\] = \[\]/);
  assert.match(source, /ackAll\(metadataMessages\)/);
  assert.match(source, /retryAll\(metadataMessages\)/);
  assert.match(source, /ackAll\(playlistMessages\)/);
  assert.match(source, /retryAll\(playlistMessages\)/);
  assert.doesNotMatch(source, /extractValidatedWakeFromBatch/);
});

test("Cron deadline signalをmetadata同期とplaylist同期へ渡す", () => {
  assert.match(source, /syncEventPlaylists\(env, signal\)/);
  assert.match(source, /syncBatch\(env, undefined, signal,/);
  assert.match(source, /mode:\s*"scheduled_only"/);
});

test("GA4 trending sync runs before youtube metadata in 07 slot", () => {
  assert.match(source, /ga4-trending-sync/);
  assert.match(source, /syncGa4Trending\(env, signal\)/);
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
